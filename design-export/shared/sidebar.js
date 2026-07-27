/* ═══════════════════════════════════════════════════════════
   novelGENerator — Shared Sidebar (Pastel Literary Minimalist)
   ═══════════════════════════════════════════════════════════ */

(function () {
  const NAV_ITEMS = [
    { id: 'dashboard',  icon: 'home',          label: 'Beranda',        href: '/index.html' },
    { id: 'generate',   icon: 'edit_note',      label: 'Buat Novel',     href: '/generate.html' },
    { id: 'library',    icon: 'library_books',  label: 'Perpustakaan',   href: '/library.html' },
    { id: 'mimicry',    icon: 'person_play',    label: 'Tiru Gaya',      href: '/mimicry.html' },
    { id: 'editor',     icon: 'history_edu',    label: 'Editor Novel',   href: '/editor.html' },
    { id: 'evaluasi',   icon: 'analytics',      label: 'Evaluasi',       href: '/evaluasi.html' },
    { id: 'seri',       icon: 'account_tree',   label: 'Seri Novel',     href: '/seri.html' },
    { id: 'ekspor',     icon: 'file_export',    label: 'Ekspor',         href: '/ekspor.html' },
    { id: 'pengaturan', icon: 'settings',       label: 'Pengaturan',     href: '/pengaturan.html' },
  ];

  function renderSidebar(activePage) {
    const container = document.getElementById('sidebar-container');
    if (!container) return;

    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';

    // Hamburger button (mobile)
    const hamburger = document.createElement('button');
    hamburger.className = 'hamburger';
    hamburger.setAttribute('aria-label', 'Buka menu');
    hamburger.innerHTML = '<span class="material-symbols-outlined" style="font-size:20px;">menu</span>';
    document.body.appendChild(hamburger);

    // Mobile overlay
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);

    // Build nav items HTML
    const navHTML = NAV_ITEMS.map(item => `
      <a class="nav-item${item.id === activePage ? ' active' : ''}" href="${item.href}" title="${item.label}">
        <span class="nav-icon material-symbols-outlined${item.id === activePage ? ' msf' : ''}">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </a>
    `).join('');

    container.innerHTML = `
      <aside class="sidebar${isCollapsed ? ' collapsed' : ''}" id="app-sidebar">
        <div class="sidebar-header">
          <div class="logo">
            <span class="logo-text">novelGENerator</span>
            <span class="logo-sub">Meja Tulis Digital</span>
          </div>
          <button class="sidebar-toggle" id="sidebar-toggle-btn" title="Kecilkan/perbesar sidebar">
            <span class="material-symbols-outlined" style="font-size:18px;">${isCollapsed ? 'chevron_right' : 'chevron_left'}</span>
          </button>
        </div>

        <a class="sidebar-cta" href="/generate.html">
          <span class="material-symbols-outlined" style="font-size:18px;">add</span>
          <span class="cta-label">Tulis Baru</span>
        </a>

        <nav class="sidebar-nav">
          ${navHTML}
        </nav>

        <div class="sidebar-footer">
          <span class="nav-label">v1.0.0</span>
        </div>
      </aside>
    `;

    // Sync collapsed state to .app
    const appEl = document.querySelector('.app');
    if (appEl && isCollapsed) appEl.classList.add('sidebar-collapsed');

    // Toggle collapse
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar   = document.getElementById('app-sidebar');

    toggleBtn.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      if (appEl) appEl.classList.toggle('sidebar-collapsed', collapsed);
      localStorage.setItem('sidebar_collapsed', collapsed);
      const icon = toggleBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = collapsed ? 'chevron_right' : 'chevron_left';
    });

    // Mobile hamburger
    hamburger.addEventListener('click', () => {
      sidebar.classList.add('mobile-open');
      overlay.classList.add('visible');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('visible');
    });
    sidebar.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('visible');
      });
    });
  }

  window.renderSidebar = renderSidebar;
})();
