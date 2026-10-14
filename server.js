
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const SESSION_NAME = 'mysiteofficial.sid';

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable.');
  process.exit(1);
}

if (isProduction && !process.env.SESSION_SECRET) {
  console.error('Missing SESSION_SECRET environment variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', error => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

const PgSession = connectPgSimple(session);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  name: SESSION_NAME,
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Prea multe încercări. Încearcă din nou peste 15 minute.'
  }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Ai depășit numărul de înregistrări permise. Încearcă din nou mai târziu.'
  }
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Ai trimis prea multe mesaje. Încearcă din nou mai târziu.'
  }
});

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanUsername(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 254;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function emailIsConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function requireCaptcha(req, res) {
  const answer = String(req.body.captchaAnswer || '').trim();
  const expected = req.session.captchaAnswer;

  delete req.session.captchaAnswer;

  if (
    expected === undefined ||
    answer === '' ||
    !safeEqual(answer, String(expected))
  ) {
    res.status(400).json({
      error: 'Răspunsul la verificare este incorect. Reîncarcă verificarea și încearcă din nou.'
    });

    return false;
  }

  return true;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function sendVerificationEmail(email, name, code) {
  if (!emailIsConfigured()) {
    throw new Error('Email service is not configured.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [email],
      subject: 'Codul tău de verificare — MySiteOfficial',
      html: `
        <!doctype html>
        <html lang="ro">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
          </head>
          <body style="margin:0;padding:0;background:#08090d;color:#f5f5f7;font-family:Arial,sans-serif">
            <div style="max-width:560px;margin:0 auto;padding:40px 22px">
              <div style="font-size:23px;font-weight:800;letter-spacing:-1px;margin-bottom:34px">
                MySite<span style="color:#a78bfa">Official</span>
              </div>
              <div style="padding:30px;border:1px solid #282832;border-radius:18px;background:#111117">
                <p style="color:#b8b8c5;font-size:13px;letter-spacing:2px;text-transform:uppercase">Verificare email</p>
                <h1 style="font-size:27px;line-height:1.3;margin:12px 0">Salut, ${escapeHtml(name)}!</h1>
                <p style="color:#c4c4d0;line-height:1.7">
                  Folosește codul de mai jos pentru a-ți confirma adresa de email și a-ți activa contul.
                </p>
                <div style="margin:28px 0;padding:20px;text-align:center;border-radius:12px;background:#1c1b28;border:1px solid #38334f">
                  <span style="font-size:36px;letter-spacing:10px;font-weight:800;color:#c4b5fd">${code}</span>
                </div>
                <p style="color:#aaaab9;line-height:1.7;font-size:14px">
                  Codul este valabil timp de 10 minute. Nu îl distribui nimănui.
                </p>
              </div>
              <p style="font-size:12px;color:#777785;line-height:1.6;margin-top:24px">
                Dacă nu ai solicitat crearea unui cont, poți ignora acest mesaj.
              </p>
            </div>
          </body>
        </html>
      `
    })
  });

  if (!response.ok) {
    const details = await response.text();
    console.error('Resend verification email failed:', response.status, details);
    throw new Error('Verification email could not be sent.');
  }
}

async function sendContactEmail({ name, email, service, message }) {
  if (!emailIsConfigured() || !process.env.CONTACT_EMAIL) {
    throw new Error('Contact email is not configured.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [process.env.CONTACT_EMAIL],
      reply_to: email,
      subject: `Solicitare nouă MySiteOfficial — ${service}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
          <h2>Solicitare nouă de pe MySiteOfficial</h2>
          <p><strong>Nume:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Serviciu:</strong> ${escapeHtml(service)}</p>
          <h3>Mesaj</h3>
          <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const details = await response.text();
    console.error('Resend contact email failed:', response.status, details);
    throw new Error('Contact email could not be sent.');
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

    CREATE INDEX IF NOT EXISTS users_verification_expiry_idx
      ON users (verification_expires_at);

    CREATE TABLE IF NOT EXISTS contact_messages (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(254) NOT NULL,
      service VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS username VARCHAR(40);
  `);

  const { rows } = await pool.query(`
    SELECT id, name
    FROM users
    WHERE username IS NULL OR BTRIM(username) = ''
    ORDER BY id
  `);

  for (const user of rows) {
    const base = cleanUsername(user.name)
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 12) || 'user';

    let candidate = `${base}${user.id}`.slice(0, 24);
    let suffix = 1;

    while (true) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id <> $2',
        [candidate, user.id]
      );

      if (!existing.rows.length) break;

      const ending = `${user.id}${suffix++}`;
      candidate = `${base.slice(0, Math.max(1, 24 - ending.length))}${ending}`;
    }

    await pool.query(
      'UPDATE users SET username = $1 WHERE id = $2',
      [candidate, user.id]
    );
  }

  await pool.query(`
    ALTER TABLE users
      ALTER COLUMN username SET NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
      ON users (username);
  `);
}

app.get('/api/health', asyncRoute(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    emailConfigured: emailIsConfigured(),
    contactConfigured: Boolean(process.env.CONTACT_EMAIL)
  });
});

app.get('/api/captcha', asyncRoute(async (req, res) => {
  const first = crypto.randomInt(2, 10);
  const second = crypto.randomInt(1, 10);

  req.session.captchaAnswer = first + second;

  res.set('Cache-Control', 'no-store');

  await new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });

  res.json({
    question: `${first} + ${second} = ?`
  });
}));

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (!req.session.userId) {
    return res.json({ user: null });
  }

  const { rows } = await pool.query(
    `SELECT id, name, username, email, is_verified
     FROM users
     WHERE id = $1`,
    [req.session.userId]
  );

  const user = rows[0];

  if (!user || !user.is_verified) {
    req.session.userId = null;
    return res.json({ user: null });
  }

  res.json({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      isVerified: user.is_verified
    }
  });
}));

app.post('/api/auth/register', registerLimiter, asyncRoute(async (req, res) => {
  if (!requireCaptcha(req, res)) return;

  if (!emailIsConfigured()) {
    return res.status(503).json({
      error: 'Verificarea prin email nu este configurată momentan.'
    });
  }

  const name = String(req.body.name || '').trim();

  const username = cleanUsername(
    req.body.username ??
    req.body.userName ??
    req.body.registerUsername ??
    req.body.handle
  );

  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({
      error: 'Numele trebuie să aibă între 2 și 80 de caractere.'
    });
  }

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({
      error: 'Username-ul trebuie să aibă între 3 și 24 de caractere și să conțină doar litere, cifre sau underscore (_).'
    });
  }

  if (!validEmail(email)) {
    return res.status(400).json({
      error: 'Introdu o adresă de email validă.'
    });
  }

  if (
    password.length < 8 ||
    password.length > 72 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return res.status(400).json({
      error: 'Parola trebuie să aibă între 8 și 72 de caractere și să includă litere mici, litere mari și cel puțin o cifră.'
    });
  }

  const existingEmail = await pool.query(
    `SELECT id, is_verified, verification_expires_at
     FROM users
     WHERE email = $1`,
    [email]
  );

  if (existingEmail.rows.length) {
    const existing = existingEmail.rows[0];

    if (existing.is_verified) {
      return res.status(409).json({
        error: 'Există deja un cont cu această adresă de email.'
      });
    }

    const expired = !existing.verification_expires_at ||
      new Date(existing.verification_expires_at).getTime() < Date.now();

    if (!expired) {
      return res.status(409).json({
        error: 'Există deja un cont neconfirmat pentru acest email. Așteaptă expirarea codului sau folosește alt email.'
      });
    }

    await pool.query(
      'DELETE FROM users WHERE id = $1 AND is_verified = FALSE',
      [existing.id]
    );
  }

  const existingUsername = await pool.query(
    'SELECT id FROM users WHERE LOWER(username) = $1',
    [username]
  );

  if (existingUsername.rows.length) {
    return res.status(409).json({
      error: 'Acest username este deja folosit. Alege altul.'
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  let created;

  try {
    created = await pool.query(
      `INSERT INTO users
        (name, username, email, password_hash,
         verification_token_hash, verification_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [name, username, email, passwordHash, codeHash, expiresAt]
    );
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'Emailul sau username-ul este deja folosit. Încearcă alt username.'
      });
    }

    throw error;
  }

  try {
    await sendVerificationEmail(email, name, code);
  } catch (error) {
    await pool.query(
      'DELETE FROM users WHERE id = $1 AND is_verified = FALSE',
      [created.rows[0].id]
    );

    return res.status(502).json({
      error: 'Nu am putut trimite codul. Verifică setările Resend și încearcă din nou.'
    });
  }

  res.status(201).json({
    message: 'Am trimis un cod de 6 cifre pe email. Introdu codul în următoarele 10 minute.',
    email
  });
}));

app.post('/api/auth/verify-code', authLimiter, asyncRoute(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const code = String(req.body.code || '').trim();

  if (!validEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      error: 'Introdu adresa de email și codul de 6 cifre.'
    });
  }

  const { rows } = await pool.query(
    `SELECT id, name, username, email, verification_token_hash,
            verification_expires_at, is_verified
     FROM users
     WHERE email = $1`,
    [email]
  );

  const user = rows[0];

  if (!user || user.is_verified || !user.verification_token_hash) {
    return res.status(400).json({
      error: 'Codul este invalid sau a fost deja folosit.'
    });
  }

  if (
    !user.verification_expires_at ||
    new Date(user.verification_expires_at).getTime() < Date.now()
  ) {
    return res.status(400).json({
      error: 'Codul a expirat. Începe din nou procesul de înregistrare.'
    });
  }

  if (!(await bcrypt.compare(code, user.verification_token_hash))) {
    return res.status(400).json({
      error: 'Codul introdus este incorect.'
    });
  }

  const update = await pool.query(
    `UPDATE users
     SET is_verified = TRUE,
         verification_token_hash = NULL,
         verification_expires_at = NULL,
         last_login_at = NOW()
     WHERE id = $1
       AND is_verified = FALSE
       AND verification_token_hash = $2
     RETURNING id`,
    [user.id, user.verification_token_hash]
  );

  if (!update.rows.length) {
    return res.status(400).json({
      error: 'Codul a fost deja folosit sau nu mai este valid.'
    });
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });

  req.session.userId = user.id;

  await new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });

  res.json({
    message: 'Email confirmat! Contul tău este activ.',
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      isVerified: true
    }
  });
}));

app.get('/api/auth/verify', asyncRoute(async (req, res) => {
  const email = cleanEmail(req.query.email);
  const token = String(req.query.token || '');

  if (!validEmail(email) || !/^[a-f0-9]{64}$/i.test(token)) {
    return res.redirect('/?verification_error=1#auth');
  }

  const tokenHash = hashToken(token);

  const { rows } = await pool.query(
    `SELECT id, verification_token_hash, verification_expires_at, is_verified
     FROM users
     WHERE email = $1`,
    [email]
  );

  const user = rows[0];

  if (
    !user ||
    user.is_verified ||
    !user.verification_token_hash ||
    !user.verification_expires_at ||
    new Date(user.verification_expires_at).getTime() < Date.now() ||
    !safeEqual(user.verification_token_hash, tokenHash)
  ) {
    return res.redirect('/?verification_error=1#auth');
  }

  await pool.query(
    `UPDATE users
     SET is_verified = TRUE,
         verification_token_hash = NULL,
         verification_expires_at = NULL
     WHERE id = $1`,
    [user.id]
  );

  res.redirect('/?verified=1#auth');
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  if (!requireCaptcha(req, res)) return;

  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!validEmail(email) || !password || password.length > 72) {
    return res.status(400).json({
      error: 'Email sau parolă incorectă.'
    });
  }

  const { rows } = await pool.query(
    `SELECT id, name, username, email, password_hash, is_verified
     FROM users
     WHERE email = $1`,
    [email]
  );

  const user = rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({
      error: 'Email sau parolă incorectă.'
    });
  }

  if (!user.is_verified) {
    return res.status(403).json({
      error: 'Trebuie să confirmi adresa de email înainte să te conectezi.'
    });
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });

  req.session.userId = user.id;

  await pool.query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );

  await new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });

  res.json({
    message: 'Autentificare reușită.',
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      isVerified: user.is_verified
    }
  });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  if (req.session) {
    await new Promise((resolve, reject) => {
      req.session.destroy(error => error ? reject(error) : resolve());
    });
  }

  res.clearCookie(SESSION_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax'
  });

  res.json({ message: 'Te-ai deconectat.' });
}));

app.post('/api/contact', contactLimiter, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = cleanEmail(req.body.email);
  const service = String(req.body.service || '').trim();
  const message = String(req.body.message || '').trim();

  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({
      error: 'Introdu un nume valid.'
    });
  }

  if (!validEmail(email)) {
    return res.status(400).json({
      error: 'Introdu o adresă de email validă.'
    });
  }

  const allowedServices = [
    'Landing Page',
    'Website Business',
    'Magazin online',
    'UI/UX Design',
    'Alt proiect'
  ];

  if (!allowedServices.includes(service)) {
    return res.status(400).json({
      error: 'Selectează un serviciu valid.'
    });
  }

  if (message.length < 10 || message.length > 5000) {
    return res.status(400).json({
      error: 'Mesajul trebuie să aibă între 10 și 5000 de caractere.'
    });
  }

  await pool.query(
    `INSERT INTO contact_messages (name, email, service, message)
     VALUES ($1, $2, $3, $4)`,
    [name, email, service, message]
  );

  try {
    await sendContactEmail({ name, email, service, message });
  } catch (error) {
    console.error('Contact notification failed:', error.message);

    return res.status(502).json({
      error: 'Mesajul a fost salvat, dar notificarea email nu a putut fi trimisă. Te rugăm să încerci din nou mai târziu.'
    });
  }

  res.status(201).json({
    message: 'Mesajul tău a fost trimis cu succes. Îți vom răspunde în curând.'
  });
}));

const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir, {
  index: false,
  dotfiles: 'deny',
  etag: true,
  maxAge: isProduction ? '1h' : 0
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'Endpoint inexistent.'
    });
  }

  res.sendFile(path.join(publicDir, 'index.html'), error => {
    if (error) next(error);
  });
});

app.use((error, req, res, next) => {
  console.error('Server error:', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'A apărut o eroare pe server. Încearcă din nou.'
  });
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`MySiteOfficial server running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
