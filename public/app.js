(() => {
  'use strict';

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));
  const toastRegion = $('#toastRegion');
  const backdrop = $('#authBackdrop');
  const loginForm = $('#loginForm');
  const registerForm = $('#registerForm');
  const authSuccess = $('#authSuccess');
  const authTitle = $('#authTitle');
  const authSubtitle = $('#authSubtitle');
  let activeAuthTab = 'login';

  function showToast(message, type = 'success') {
    if (!toastRegion) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 5200);
  }

  async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    let data = {};
    try { data = await response.json(); } catch (_) { /* response may be empty */ }
    if (!response.ok) {
      const error = new Error(data.error || 'Cererea nu a putut fi finalizată. Încearcă din nou.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function loadCaptcha() {
    const form = activeAuthTab === 'register' ? registerForm : loginForm;
    if (!form) return;
    const question = $('[data-captcha-question]', form);
    const answer = $('[name="captchaAnswer"]', form);
    if (question) question.textContent = '…';
    if (answer) answer.value = '';
    try {
      const data = await apiRequest('/api/captcha');
      if (question) question.textContent = data.question;
    } catch (_) {
      if (question) question.textContent = 'Reîncarcă verificarea';
    }
  }

  function setAuthTab(tab) {
    activeAuthTab = tab === 'register' ? 'register' : 'login';
    const isRegister = activeAuthTab === 'register';
    loginForm.hidden = isRegister;
    registerForm.hidden = !isRegister;
    authSuccess.hidden = true;
    authTitle.textContent = isRegister ? 'Hai să creăm contul.' : 'Mă bucur să te revăd.';
    authSubtitle.textContent = isRegister ? 'Un cont nou începe cu adresa ta de email.' : 'Intră în cont pentru a continua.';
    $$('[data-auth-tab]').forEach(button => {
      const active = button.dataset.authTab === activeAuthTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    $$('.auth-status').forEach(el => { el.textContent = ''; });
    loadCaptcha();
  }

  function openAuth(tab = 'login') {
    backdrop.hidden = false;
    document.body.classList.add('modal-open');
    setAuthTab(tab);
    window.setTimeout(() => {
      const first = $('input', activeAuthTab === 'register' ? registerForm : loginForm);
      if (first) first.focus({ preventScroll: true });
    }, 80);
  }

  function closeAuth() {
    backdrop.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function setAuthMessage(form, message, isError = true) {
    const el = $('.auth-status', form);
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#ff9da9' : '#8de1d0';
  }

  async function handleAuthSubmit(event, form, endpoint) {
    event.preventDefault();
    const submit = $('button[type="submit"]', form);
    const status = $('.auth-status', form);
    const data = Object.fromEntries(new FormData(form).entries());
    if (submit) { submit.disabled = true; submit.style.opacity = '.65'; }
    if (status) status.textContent = '';
    try {
      const result = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify(data) });
      if (endpoint.endsWith('/register')) {
        loginForm.hidden = true;
        registerForm.hidden = true;
        $$('.auth-tab').forEach(el => { el.hidden = true; });
        $('.auth-bottom').hidden = true;
        authTitle.textContent = 'Încă un singur pas.';
        authSubtitle.textContent = 'Am trimis un email pentru confirmare.';
        $('#authSuccessText').textContent = result.message;
        authSuccess.hidden = false;
        return;
      }
      closeAuth();
      showToast(`Bine ai venit, ${result.user.name}!`, 'success');
      updateAccount(result.user);
    } catch (error) {
      setAuthMessage(form, error.message, true);
    } finally {
      if (submit) { submit.disabled = false; submit.style.opacity = ''; }
      if (!backdrop.hidden) await loadCaptcha();
    }
  }

  function resetAuthModal() {
    $$('.auth-tab').forEach(el => { el.hidden = false; });
    $('.auth-bottom').hidden = false;
    loginForm.reset();
    registerForm.reset();
    authSuccess.hidden = true;
    $$('.auth-status').forEach(el => { el.textContent = ''; });
  }

  function updateAccount(user) {
    const pill = $('#accountPill');
    if (!user) {
      pill.hidden = true;
      return;
    }
    $('#accountAvatar').textContent = (user.name || user.email || 'M').trim().charAt(0).toUpperCase();
    $('#accountEmail').textContent = user.email;
    pill.hidden = false;
  }

  $('#closeAuth').addEventListener('click', () => { closeAuth(); resetAuthModal(); });
  $('#closeSuccess').addEventListener('click', () => { closeAuth(); resetAuthModal(); });
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) { closeAuth(); resetAuthModal(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !backdrop.hidden) { closeAuth(); resetAuthModal(); }
  });
  $$('[data-open-auth]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    resetAuthModal();
    openAuth(button.dataset.openAuth);
    $('#mobileNav').classList.remove('is-open');
    $('#mobileMenuToggle').setAttribute('aria-expanded', 'false');
  }));
  $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
  $$('[data-refresh-captcha]').forEach(button => button.addEventListener('click', loadCaptcha));
  loginForm.addEventListener('submit', event => handleAuthSubmit(event, loginForm, '/api/auth/login'));
  registerForm.addEventListener('submit', event => handleAuthSubmit(event, registerForm, '/api/auth/register'));

  $('#logoutButton').addEventListener('click', async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
      updateAccount(null);
      showToast('Te-ai deconectat în siguranță.');
    } catch (error) { showToast(error.message, 'error'); }
  });

  const mobileToggle = $('#mobileMenuToggle');
  mobileToggle.addEventListener('click', () => {
    const isOpen = $('#mobileNav').classList.toggle('is-open');
    mobileToggle.setAttribute('aria-expanded', String(isOpen));
  });
  $$('#mobileNav a').forEach(link => link.addEventListener('click', () => {
    $('#mobileNav').classList.remove('is-open');
    mobileToggle.setAttribute('aria-expanded', 'false');
  }));

  const contactForm = $('#contactForm');
  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('button[type="submit"]', contactForm);
    const status = $('#contactStatus');
    const data = Object.fromEntries(new FormData(contactForm).entries());
    button.disabled = true;
    button.style.opacity = '.65';
    status.className = 'form-status';
    status.textContent = 'Se trimite solicitarea…';
    try {
      const result = await apiRequest('/api/contact', { method: 'POST', body: JSON.stringify(data) });
      status.textContent = result.message;
      status.className = 'form-status';
      contactForm.reset();
      showToast('Solicitarea a fost înregistrată.', 'success');
    } catch (error) {
      status.textContent = error.message;
      status.className = 'form-status error';
    } finally {
      button.disabled = false;
      button.style.opacity = '';
    }
  });

  function initReveal() {
    const items = $$('.reveal');
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      items.forEach(item => item.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px 0px' });
    items.forEach(item => observer.observe(item));
  }

  async function initUser() {
    try {
      const result = await apiRequest('/api/auth/me');
      updateAccount(result.user);
    } catch (_) { updateAccount(null); }
  }

  function handleVerificationRedirect() {
    const url = new URL(window.location.href);
    if (url.searchParams.get('verified') === '1') {
      showToast('Email confirmat. Acum te poți conecta!', 'success');
      openAuth('login');
      url.searchParams.delete('verified');
      history.replaceState({}, '', url.pathname + url.hash);
    } else if (url.searchParams.get('verification_error') === '1') {
      showToast('Linkul de confirmare este invalid sau a expirat. Înregistrează-te din nou.', 'error');
      openAuth('register');
      url.searchParams.delete('verification_error');
      history.replaceState({}, '', url.pathname + url.hash);
    } else if (window.location.hash === '#auth') {
      openAuth('login');
    }
  }

  $('#currentYear').textContent = String(new Date().getFullYear());
  initReveal();
  initUser();
  handleVerificationRedirect();
})();
