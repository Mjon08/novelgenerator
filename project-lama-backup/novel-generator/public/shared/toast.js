/* ═══════════════════════════════════════════════════════════
   novelGENerator – Toast Notification System
   ═══════════════════════════════════════════════════════════ */

(function () {
  const MAX_TOASTS = 4;

  const ICONS = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warn: '⚠️',
  };

  let container = null;

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(type, msg, duration) {
    const c = getContainer();

    // Remove oldest if over limit
    while (c.children.length >= MAX_TOASTS) {
      removeToast(c.firstElementChild);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${ICONS[type] || 'ℹ️'}</span>
      <span class="toast-msg">${msg}</span>
      <button class="toast-close" aria-label="Tutup">✕</button>
    `;

    c.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { toast.classList.add('show'); });
    });

    const close = toast.querySelector('.toast-close');
    close.addEventListener('click', () => removeToast(toast));

    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }

    return toast;
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('hide');
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 350);
  }

  window.toast = {
    success(msg, duration = 3000) { return show('success', msg, duration); },
    error(msg, duration = 5000)   { return show('error', msg, duration); },
    info(msg, duration = 3000)    { return show('info', msg, duration); },
    warn(msg, duration = 4000)    { return show('warn', msg, duration); },
  };
})();
