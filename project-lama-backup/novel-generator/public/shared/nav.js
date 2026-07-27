// nav.js - Shared Navigation: Theme Toggle + Collapsible Sidebar
(function () {
  // ── Logout ──
  window.logoutApp = async function () {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
    window.location.href = '/login.html';
  };

  // ── Dark Mode ──
  const isDark = localStorage.getItem('theme') === 'dark' ||
    (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) document.documentElement.classList.add('dark');

  window.toggleTheme = function () {
    const on = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', on ? 'dark' : 'light');
    updateThemeIcons();
  };

  function updateThemeIcons() {
    const dark = document.documentElement.classList.contains('dark');
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.innerHTML = dark
        ? '<i class="ph ph-sun text-[20px]"></i>'
        : '<i class="ph ph-moon text-[20px]"></i>';
      btn.title = dark ? 'Mode Terang' : 'Mode Gelap';
    });
  }

  // ── Sidebar Toggle ──
  window.toggleSidebar = function () {
    const sb = document.getElementById('app-sidebar');
    if (!sb) return;
    const closing = !sb.classList.contains('-translate-x-[300px]');
    if (closing) {
      sb.classList.add('-translate-x-[300px]');
      localStorage.setItem('sidebarState', 'closed');
    } else {
      sb.classList.remove('-translate-x-[300px]');
      localStorage.setItem('sidebarState', 'open');
    }
    applyMainMargin(!closing);
  };

  function applyMainMargin(open) {
    const m = document.querySelector('main');
    if (!m) return;
    if (open && window.innerWidth >= 768) {
      m.style.marginLeft = '280px';
      m.style.width = 'calc(100% - 280px)';
    } else {
      m.style.marginLeft = '';
      m.style.width = '';
    }
  }

  function restoreSidebar() {
    const sb = document.getElementById('app-sidebar');
    const open = localStorage.getItem('sidebarState') === 'open' && window.innerWidth >= 768;
    if (sb) {
      if (open) sb.classList.remove('-translate-x-[300px]');
      else sb.classList.add('-translate-x-[300px]');
    }
    applyMainMargin(open);
  }

  // ── Init ──
  document.addEventListener('DOMContentLoaded', () => {
    updateThemeIcons();
    restoreSidebar();
  });
  window.addEventListener('resize', restoreSidebar);
})();
