
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
  let pendingVerificationEmail = '';

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
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok) {
      const error = new Error(
        data.error || 'Cererea nu a putut fi finalizată. Încearcă din nou.'
      );
      error.status = response.status;
      throw error;
    }

    return data;
  }

  async function loadCaptcha() {
    const form = activeAuthTab === 'register' ? registerForm : loginForm;
    if (!form || form.hidden) return;

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

  function setAuthMessage(form, message, isError = true) {
    const el = $('.auth-status', form);
    if (!el) return;

    el.textContent = message;
    el.style.color = isError ? '#ff9da9' : '#8de1d0';
  }

  function setAuthTab(tab) {
    activeAuthTab = tab === 'register' ? 'register' : 'login';

    const isRegister = activeAuthTab === 'register';

    loginForm.hidden = isRegister;
    registerForm.hidden = !isRegister;
    authSuccess.hidden = true;

    $$('.auth-tab').forEach(el => {
      el.hidden = false;
    });

    $('.auth-bottom').hidden = false;

    authTitle.textContent = isRegister
      ? 'Hai să creăm contul.'
      : 'Mă bucur să te revăd.';

    authSubtitle.textContent = isRegister
      ? 'Alege un username și confirmă adresa de email.'
      : 'Intră în cont pentru a continua.';

    $$('[data-auth-tab]').forEach(button => {
      const active = button.dataset.authTab === activeAuthTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });

    $$('.auth-status').forEach(el => {
      el.textContent = '';
    });

    loadCaptcha();
  }

  function openAuth(tab = 'login') {
    backdrop.hidden = false;
    document.body.classList.add('modal-open');
    setAuthTab(tab);

    window.setTimeout(() => {
      const form = activeAuthTab === 'register' ? registerForm : loginForm;
      const first = $('input:not([type="hidden"])', form);
      if (first) first.focus({ preventScroll: true });
    }, 80);
  }

  function closeAuth() {
    backdrop.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function resetAuthModal() {
    $$('.auth-tab').forEach(el => {
      el.hidden = false;
    });

    $('.auth-bottom').hidden = false;

    loginForm.reset();
    registerForm.reset();

    authSuccess.hidden = true;
    loginForm.hidden = false;
    registerForm.hidden = true;

    pendingVerificationEmail = '';

    $$('.auth-status').forEach(el => {
      el.textContent = '';
    });

    const verificationForm = $('#verificationForm');
    if (verificationForm) verificationForm.remove();

    const resendButton = $('#resendCodeButton');
    if (resendButton) resendButton.remove();
  }

  function updateAccount(user) {
    const pill = $('#accountPill');
    const accountEmail = $('#accountEmail');
    const accountAvatar = $('#accountAvatar');

    if (!pill) return;

    if (!user) {
      pill.hidden = true;

      const navLogin = $$('.nav-login');
      navLogin.forEach(button => {
        button.hidden = false;
      });

      return;
    }

    const username = String(user.username || user.name || 'user')
      .trim()
      .replace(/^@+/, '');

    if (accountAvatar) {
      accountAvatar.textContent = username.charAt(0).toUpperCase() || 'M';
    }

    if (accountEmail) {
      accountEmail.textContent = `Logged in as @${username}`;
      accountEmail.setAttribute('title', user.email || '');
    }

    pill.hidden = false;

    $$('.nav-login').forEach(button => {
      button.hidden = true;
    });
  }

  function showVerificationForm(email, message) {
    pendingVerificationEmail = email;

    loginForm.hidden = true;
    registerForm.hidden = true;
    authSuccess.hidden = true;

    $$('.auth-tab').forEach(el => {
      el.hidden = true;
    });

    $('.auth-bottom').hidden = true;

    authTitle.textContent = 'Verifică-ți emailul.';
    authSubtitle.textContent = 'Introdu codul de 6 cifre pe care l-am trimis.';

    let form = $('#verificationForm');

    if (!form) {
      form = document.createElement('form');
      form.className = 'auth-form';
      form.id = 'verificationForm';

      form.innerHTML = `
        <label>Adresa de email
          <input name="email" type="email" autocomplete="email" required readonly>
        </label>
        <label>Cod de verificare
          <input
            name="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            minlength="6"
            maxlength="6"
            placeholder="123456"
            aria-describedby="verificationHint"
            required
          >
          <small class="field-hint" id="verificationHint">
            Codul expiră după 10 minute.
          </small>
        </label>
        <button class="button button-primary button-large auth-submit" type="submit">
          Confirmă și creează contul <span>↗</span>
        </button>
        <p class="auth-status" role="status" aria-live="polite"></p>
        <button type="button" class="text-link" id="backToRegister">
          Înapoi la înregistrare
        </button>
      `;

      $('.auth-heading').after(form);

      form.addEventListener('submit', async event => {
        event.preventDefault();

        const submit = $('button[type="submit"]', form);
        const status = $('.auth-status', form);
        const data = Object.fromEntries(new FormData(form).entries());

        data.email = pendingVerificationEmail || data.email;
        data.code = String(data.code || '').trim();

        if (!/^\d{6}$/.test(data.code)) {
          setAuthMessage(form, 'Introdu codul complet, format din 6 cifre.');
          return;
        }

        if (submit) {
          submit.disabled = true;
          submit.style.opacity = '.65';
        }

        if (status) status.textContent = '';

        try {
          const result = await apiRequest('/api/auth/verify-code', {
            method: 'POST',
            body: JSON.stringify(data)
          });

          closeAuth();
          resetAuthModal();

          if (result.user) updateAccount(result.user);

          showToast(
            `Cont confirmat. Bine ai venit, @${result.user?.username || 'user'}!`,
            'success'
          );

          await initUser();
        } catch (error) {
          setAuthMessage(form, error.message);
        } finally {
          if (submit) {
            submit.disabled = false;
            submit.style.opacity = '';
          }
        }
      });

      $('#backToRegister').addEventListener('click', () => {
        form.remove();
        setAuthTab('register');
      });
    }

    form.hidden = false;
    form.elements.email.value = email;
    form.elements.code.value = '';

    const status = $('.auth-status', form);
    if (status) {
      status.textContent = message || '';
      status.style.color = '#8de1d0';
    }

    window.setTimeout(() => {
      form.elements.code.focus({ preventScroll: true });
    }, 80);
  }

  async function handleAuthSubmit(event, form, endpoint) {
    event.preventDefault();

    const submit = $('button[type="submit"]', form);
    const status = $('.auth-status', form);
    const data = Object.fromEntries(new FormData(form).entries());

    if (submit) {
      submit.disabled = true;
      submit.style.opacity = '.65';
    }

    if (status) status.textContent = '';

    try {
      const result = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(data)
      });

      if (endpoint.endsWith('/register')) {
        showVerificationForm(
          result.email || data.email,
          result.message || 'Am trimis codul de verificare pe email.'
        );
        return;
      }

      closeAuth();
      resetAuthModal();

      updateAccount(result.user);

      showToast(
        `Logged in as @${result.user.username || result.user.name}!`,
        'success'
      );
    } catch (error) {
      setAuthMessage(form, error.message);
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.style.opacity = '';
      }

      if (!backdrop.hidden && !$('#verificationForm')) {
        await loadCaptcha();
      }
    }
  }

  $('#closeAuth').addEventListener('click', () => {
    closeAuth();
    resetAuthModal();
  });

  $('#closeSuccess').addEventListener('click', () => {
    closeAuth();
    resetAuthModal();
  });

  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
      closeAuth();
      resetAuthModal();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !backdrop.hidden) {
      closeAuth();
      resetAuthModal();
    }
  });

  $$('[data-open-auth]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();

      resetAuthModal();
      openAuth(button.dataset.openAuth);

      const mobileNav = $('#mobileNav');
      const mobileToggle = $('#mobileMenuToggle');

      if (mobileNav) mobileNav.classList.remove('is-open');
      if (mobileToggle) mobileToggle.setAttribute('aria-expanded', 'false');
    });
  });

  $$('[data-auth-tab]').forEach(button => {
    button.addEventListener('click', () => setAuthTab(button.dataset.authTab));
  });

  $$('[data-refresh-captcha]').forEach(button => {
    button.addEventListener('click', loadCaptcha);
  });

  loginForm.addEventListener('submit', event => {
    handleAuthSubmit(event, loginForm, '/api/auth/login');
  });

  registerForm.addEventListener('submit', event => {
    handleAuthSubmit(event, registerForm, '/api/auth/register');
  });

  const logoutButton = $('#logoutButton');

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await apiRequest('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({})
        });

        updateAccount(null);
        showToast('Te-ai deconectat în siguranță.');
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  const mobileToggle = $('#mobileMenuToggle');

  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = $('#mobileNav').classList.toggle('is-open');
      mobileToggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  $$('#mobileNav a').forEach(link => {
    link.addEventListener('click', () => {
      $('#mobileNav').classList.remove('is-open');
      if (mobileToggle) mobileToggle.setAttribute('aria-expanded', 'false');
    });
  });

  const contactForm = $('#contactForm');

  if (contactForm) {
    contactForm.addEventListener('submit', async event => {
      event.preventDefault();

      const button = $('button[type="submit"]', contactForm);
      const status = $('#contactStatus');
      const data = Object.fromEntries(new FormData(contactForm).entries());

      if (button) {
        button.disabled = true;
        button.style.opacity = '.65';
      }

      if (status) {
        status.className = 'form-status';
        status.textContent = 'Se trimite solicitarea…';
      }

      try {
        const result = await apiRequest('/api/contact', {
          method: 'POST',
          body: JSON.stringify(data)
        });

        if (status) {
          status.textContent = result.message;
          status.className = 'form-status';
        }

        contactForm.reset();
        showToast('Solicitarea a fost înregistrată.', 'success');
      } catch (error) {
        if (status) {
          status.textContent = error.message;
          status.className = 'form-status error';
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.style.opacity = '';
        }
      }
    });
  }

  function initReveal() {
    const items = $$('.reveal');

    if (
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
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
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -35px 0px'
    });

    items.forEach(item => observer.observe(item));
  }

  async function initUser() {
    try {
      const result = await apiRequest('/api/auth/me');
      updateAccount(result.user);
    } catch (_) {
      updateAccount(null);
    }
  }

  function handleVerificationRedirect() {
    const url = new URL(window.location.href);

    if (url.searchParams.get('verified') === '1') {
      showToast('Email confirmat. Acum te poți conecta!', 'success');
      openAuth('login');
      url.searchParams.delete('verified');
      history.replaceState({}, '', url.pathname + url.hash);
    } else if (url.searchParams.get('verification_error') === '1') {
      showToast(
        'Linkul de confirmare este invalid sau a expirat. Încearcă din nou.',
        'error'
      );
      openAuth('register');
      url.searchParams.delete('verification_error');
      history.replaceState({}, '', url.pathname + url.hash);
    } else if (window.location.hash === '#auth') {
      openAuth('login');
    }
  }

  const currentYear = $('#currentYear');
  if (currentYear) currentYear.textContent = String(new Date().getFullYear());

  initReveal();
  initUser();
  handleVerificationRedirect();
})();
