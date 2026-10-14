require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('path');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL. Add a PostgreSQL connection string (Render Blueprint creates one automatically).');
  process.exit(1);
}
if (!process.env.SESSION_SECRET && isProduction) {
  console.error('Missing SESSION_SECRET. Configure a strong random secret in the hosting environment.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'mysiteofficial.sid',
  secret: process.env.SESSION_SECRET || 'local-development-only-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Ai făcut prea multe încercări. Încearcă din nou peste câteva minute.' }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Ai atins limita de înregistrări. Încearcă din nou mai târziu.' }
});

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function emailIsConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}
function requireCaptcha(req, res) {
  const stored = req.session.mathCaptcha;
  const answer = String(req.body.captchaAnswer ?? '').trim();
  req.session.mathCaptcha = null;
  if (!stored || Date.now() > stored.expiresAt || !/^\d{1,3}$/.test(answer) || !safeEqual(answer, String(stored.answer))) {
    res.status(400).json({ error: 'Verificarea anti-robot nu este corectă. Rezolvă noul calcul și încearcă din nou.' });
    return false;
  }
  return true;
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function sendVerificationEmail(email, name, token, req) {
  const baseUrl = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const verifyUrl = `${baseUrl}/api/auth/verify?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const escapedName = escapeHtml(name || 'acolo');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [email],
      subject: 'Confirmă adresa de email — MySiteOfficial',
      html: `<!doctype html><html><body style="margin:0;background:#080914;color:#f7f7fb;font-family:Arial,sans-serif;padding:32px"><div style="max-width:560px;margin:0 auto;background:#111326;border:1px solid #292b45;border-radius:22px;padding:32px"><p style="color:#a99bff;font-weight:700;letter-spacing:2px;font-size:12px">MYSITEOFFICIAL</p><h1 style="font-size:28px;line-height:1.2">Bine ai venit, ${escapedName}.</h1><p style="color:#c6c7d8;line-height:1.7">Mai este un singur pas: confirmă adresa ta de email pentru a-ți activa contul.</p><p style="margin:28px 0"><a href="${verifyUrl}" style="display:inline-block;background:#8d70ff;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:700">Confirmă adresa de email</a></p><p style="color:#9698af;font-size:13px;line-height:1.6">Dacă butonul nu funcționează, copiază acest link în browser:<br><a href="${verifyUrl}" style="color:#b7aaff;word-break:break-all">${verifyUrl}</a></p><p style="color:#777991;font-size:12px;margin-top:28px">Dacă nu ai creat acest cont, poți ignora mesajul.</p></div></body></html>`
    })
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('Resend email error:', response.status, errorText.slice(0, 500));
    throw new Error('EMAIL_DELIVERY_FAILED');
  }
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      verification_token_hash TEXT,
      verification_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS users_verification_expiry_idx ON users (verification_expires_at);
    CREATE TABLE IF NOT EXISTS contact_messages (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(254) NOT NULL,
      service VARCHAR(80) NOT NULL,
      budget VARCHAR(60) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'MySiteOfficial' }));

app.get('/api/config', (req, res) => {
  res.json({ emailVerificationConfigured: emailIsConfigured() });
});

app.get('/api/captcha', (req, res) => {
  const a = crypto.randomInt(2, 10);
  const b = crypto.randomInt(1, 10);
  const plus = Math.random() > 0.25;
  const left = Math.max(a, b);
  const right = Math.min(a, b);
  const answer = plus ? a + b : left - right;
  req.session.mathCaptcha = { answer, expiresAt: Date.now() + 5 * 60 * 1000 };
  res.set('Cache-Control', 'no-store');
  res.json({ question: `${plus ? a : left} ${plus ? '+' : '−'} ${plus ? b : right} = ?` });
});

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const { rows } = await pool.query('SELECT id, name, email, is_verified FROM users WHERE id = $1', [req.session.userId]);
  if (!rows[0] || !rows[0].is_verified) {
    req.session.userId = null;
    return res.json({ user: null });
  }
  res.json({ user: { id: rows[0].id, name: rows[0].name, email: rows[0].email, isVerified: rows[0].is_verified } });
}));

app.post('/api/auth/register', registerLimiter, asyncRoute(async (req, res) => {
  if (!requireCaptcha(req, res)) return;
  if (!emailIsConfigured()) {
    return res.status(503).json({ error: 'Înregistrarea cu verificare prin email nu este încă activată pe server. Configurează RESEND_API_KEY și RESEND_FROM în Render.' });
  }

  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Introdu un nume între 2 și 80 de caractere.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Introdu o adresă de email validă.' });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Parola trebuie să conțină între 8 și 72 de caractere.' });
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ error: 'Alege o parolă cu cel puțin o literă mică, una mare și o cifră.' });
  }

  const existing = await pool.query('SELECT id, is_verified, verification_expires_at FROM users WHERE email = $1', [email]);
  if (existing.rows[0]) {
    const previous = existing.rows[0];
    const verificationExpired = !previous.verification_expires_at || new Date(previous.verification_expires_at).getTime() < Date.now();
    if (!previous.is_verified && verificationExpired) {
      await pool.query('DELETE FROM users WHERE id = $1 AND is_verified = FALSE', [previous.id]);
    } else {
      return res.status(409).json({ error: previous.is_verified ? 'Există deja un cont cu acest email. Intră în cont.' : 'Există deja un cont neconfirmat cu acest email. Verifică inboxul; poți solicita din nou înregistrarea dacă linkul expiră.' });
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);
  const created = await pool.query(
    'INSERT INTO users (name, email, password_hash, verification_token_hash, verification_expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [name, email, passwordHash, tokenHash, expiresAt]
  );
  try {
    await sendVerificationEmail(email, name, token, req);
  } catch (error) {
    await pool.query('DELETE FROM users WHERE id = $1 AND is_verified = FALSE', [created.rows[0].id]);
    return res.status(502).json({ error: 'Nu am putut trimite emailul de confirmare. Verifică setările Resend și domeniul expeditorului, apoi încearcă din nou.' });
  }
  res.status(201).json({ message: 'Contul a fost creat. Verifică inboxul și apasă linkul de confirmare; linkul expiră în 24 de ore.' });
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  if (!requireCaptcha(req, res)) return;
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!validEmail(email) || !password) return res.status(400).json({ error: 'Introdu emailul și parola.' });
  const { rows } = await pool.query('SELECT id, name, email, password_hash, is_verified FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!passwordMatches) return res.status(401).json({ error: 'Emailul sau parola nu sunt corecte.' });
  if (!user.is_verified) return res.status(403).json({ error: 'Trebuie să confirmi adresa de email înainte să intri în cont. Verifică inboxul.' });

  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  res.json({ message: 'Te-ai conectat cu succes.', user: { id: user.id, name: user.name, email: user.email, isVerified: user.is_verified } });
}));

app.get('/api/auth/verify', asyncRoute(async (req, res) => {
  const email = cleanEmail(req.query.email);
  const token = String(req.query.token || '');
  const failUrl = '/?verification_error=1#auth';
  if (!validEmail(email) || !/^[a-f0-9]{64}$/.test(token)) return res.redirect(failUrl);
  const { rows } = await pool.query('SELECT id, verification_token_hash, verification_expires_at, is_verified FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || user.is_verified || !user.verification_token_hash || !user.verification_expires_at || new Date(user.verification_expires_at).getTime() < Date.now() || !safeEqual(user.verification_token_hash, hashToken(token))) {
    return res.redirect(failUrl);
  }
  await pool.query('UPDATE users SET is_verified = TRUE, verification_token_hash = NULL, verification_expires_at = NULL WHERE id = $1', [user.id]);
  return res.redirect('/?verified=1#auth');
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  await new Promise(resolve => req.session.destroy(() => resolve()));
  res.clearCookie('mysiteofficial.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
  res.json({ message: 'Te-ai deconectat.' });
}));

app.post('/api/contact', rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false }), asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = cleanEmail(req.body.email);
  const service = String(req.body.service || '').trim().slice(0, 80);
  const budget = String(req.body.budget || '').trim().slice(0, 60);
  const message = String(req.body.message || '').trim().slice(0, 2500);
  if (name.length < 2 || name.length > 100 || !validEmail(email) || !service || !budget || message.length < 10) {
    return res.status(400).json({ error: 'Completează toate câmpurile și scrie un mesaj de cel puțin 10 caractere.' });
  }
  await pool.query('INSERT INTO contact_messages (name, email, service, budget, message) VALUES ($1, $2, $3, $4, $5)', [name, email, service, budget, message]);

  let notified = false;
  if (emailIsConfigured() && process.env.CONTACT_EMAIL) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.RESEND_FROM,
          to: [process.env.CONTACT_EMAIL],
          reply_to: email,
          subject: `Solicitare nouă MySiteOfficial — ${service}`,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.7"><h2>Solicitare nouă de pe MySiteOfficial</h2><p><b>Nume:</b> ${escapeHtml(name)}</p><p><b>Email:</b> ${escapeHtml(email)}</p><p><b>Serviciu:</b> ${escapeHtml(service)}</p><p><b>Buget:</b> ${escapeHtml(budget)}</p><p><b>Mesaj:</b><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p></div>`
        })
      });
      notified = response.ok;
      if (!response.ok) console.error('Contact notification failed:', response.status, (await response.text()).slice(0, 300));
    } catch (error) { console.error('Contact notification error:', error.message); }
  }
  res.status(201).json({ message: notified ? 'Mesajul a fost trimis. Îți mulțumesc — revin cât de curând!' : 'Mesajul a fost înregistrat. Pentru a primi notificările pe email, configurează CONTACT_EMAIL și RESEND în Render.' });
}));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProduction ? '1h' : 0, etag: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error('Request error:', err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'A apărut o eroare. Încearcă din nou.' });
});

initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`MySiteOfficial running on port ${PORT}`));
}).catch(error => {
  console.error('Database initialization failed:', error.message);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await pool.end().catch(() => {});
  process.exit(0);
});
