const fs = require('fs');
const path = require('path');

const pub = '/Users/muhammadjon/novel-generator-ai-agent-main/project-lama-backup/novel-generator/public';
const stitch = '/Users/muhammadjon/Downloads/stitch_novelgen_studio_redesign';

const map = {
  'index.html':      'dashboard_novelgen_studio/code.html',
  'generate.html':   'buat_novel_novelgen_studio/code.html',
  'editor.html':     'editor_novelgen_studio/code.html',
  'evaluasi.html':   'evaluasi_novelgen_studio/code.html',
  'mimicry.html':    'shared/tiru_gaya_novelgen_studio/code.html',
  'library.html':    'shared/perpustakaan_novelgen_studio/code.html',
  'ekspor.html':     'shared/ekspor_novelgen_studio/code.html',
  'pengaturan.html': 'shared/pengaturan_novelgen_studio/code.html',
  'seri.html':       'shared/seri_novel_novelgen_studio/code.html',
};

// ── Shared Components ──

const HEAD_INJECT = `<script src="https://unpkg.com/@phosphor-icons/web"></script>
<script src="shared/nav.js"></script>
<style>
  html.dark { color-scheme: dark; }
  html.dark body { background-color: #0f0f12 !important; color: #f3f3f6 !important; }
  html.dark header, html.dark aside { background-color: rgba(24,24,28,0.95) !important; border-color: rgba(255,255,255,0.1) !important; }
  html.dark .bg-white, html.dark .bg-surface-container-lowest, html.dark .bg-surface-container-lowest\\/80 { background-color: #18181c !important; color: #f3f3f6 !important; }
  html.dark .bg-surface-container, html.dark .bg-surface-container-low, html.dark .bg-surface-container-high, html.dark .bg-surface-variant { background-color: #1e1e24 !important; }
  html.dark h1, html.dark h2, html.dark h3, html.dark h4, html.dark h5, html.dark h6, html.dark .text-on-surface { color: #fff !important; }
  html.dark p, html.dark span, html.dark label, html.dark li, html.dark a:not(.bg-primary) { color: #c8c8d0 !important; }
  html.dark .text-outline, html.dark .text-on-surface-variant { color: #9898a6 !important; }
  html.dark .border, html.dark .border-b, html.dark [class*="border-outline"] { border-color: rgba(255,255,255,0.1) !important; }
  html.dark input, html.dark textarea, html.dark select { background-color: #1e1e24 !important; color: #f3f3f6 !important; border-color: rgba(255,255,255,0.15) !important; }
</style>`;

const HEADER = `<header class="fixed top-0 left-0 right-0 h-[52px] bg-white/90 dark:bg-[#18181c]/90 backdrop-blur-md border-b border-outline-variant/20 flex items-center justify-between px-4 z-40">
  <div class="flex items-center gap-3">
    <button onclick="toggleSidebar()" class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" title="Toggle Sidebar">
      <i class="ph ph-sidebar-simple text-[22px]"></i>
    </button>
    <div class="hidden sm:flex items-center gap-1.5">
      <div class="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
      <div class="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
      <div class="w-3 h-3 rounded-full bg-[#27c93f]"></div>
    </div>
    <div class="flex items-center gap-0.5 bg-surface-container/60 p-0.5 rounded-lg border border-outline-variant/20">
      <button onclick="window.history.back()" class="p-1 rounded hover:bg-surface-variant text-on-surface-variant transition-colors" title="Kembali"><i class="ph ph-arrow-left text-[18px]"></i></button>
      <a href="index.html" class="p-1 rounded hover:bg-surface-variant text-on-surface-variant transition-colors" title="Beranda"><i class="ph ph-house text-[18px]"></i></a>
    </div>
    <a href="index.html" class="font-bold text-on-surface text-[17px] tracking-tight hover:opacity-80 flex items-center gap-2">
      <i class="ph ph-sparkle text-primary text-[20px]"></i><span class="hidden sm:inline">novelGENerator Studio</span>
    </a>
  </div>
  <div class="flex items-center gap-1.5">
    <button onclick="toggleTheme()" class="theme-toggle-btn p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" title="Dark/Light Mode"><i class="ph ph-moon text-[20px]"></i></button>
    <a href="pengaturan.html" class="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors" title="Pengaturan"><i class="ph ph-gear text-[20px]"></i></a>
  </div>
</header>`;

function makeSidebar(activeKey) {
  const links = [
    ['index',      'ph-squares-four',   'Dashboard'],
    ['generate',   'ph-magic-wand',     'Buat Novel'],
    ['editor',     'ph-pen-nib',        'Editor'],
    ['seri',       'ph-books',          'Seri & Jilid'],
    ['mimicry',    'ph-brain',          'Tiru Gaya (DNA)'],
    ['library',    'ph-book-bookmark',  'Perpustakaan'],
    ['evaluasi',   'ph-chart-line-up',  'Evaluasi Kualitas'],
    ['ekspor',     'ph-export',         'Ekspor Karya'],
    ['pengaturan', 'ph-gear',           'Pengaturan'],
  ];
  const items = links.map(([key, icon, label]) => {
    const active = key === activeKey;
    const cls = active
      ? '!text-primary !bg-primary/10 font-semibold'
      : 'text-on-surface-variant hover:bg-surface-container';
    return `    <a class="flex items-center gap-3 px-3 py-2 rounded-lg font-label-md text-label-md transition-colors ${cls}" href="${key}.html"><i class="ph ${icon} text-[20px]"></i> ${label}</a>`;
  }).join('\n');

  return `<aside id="app-sidebar" class="w-[260px] h-[calc(100vh-68px)] fixed left-4 top-[60px] rounded-xl bg-white/95 dark:bg-[#18181c]/95 backdrop-blur-xl border border-outline-variant/30 z-40 p-4 flex flex-col justify-between shadow-xl transition-all duration-300 -translate-x-[300px]">
  <div class="flex flex-col gap-1 overflow-y-auto">
    <div class="mb-3 px-2 flex justify-between items-center">
      <p class="text-[11px] text-outline uppercase tracking-wider font-semibold">AI Studio</p>
      <button onclick="toggleSidebar()" class="p-1 rounded text-outline hover:text-on-surface"><i class="ph ph-x text-[18px]"></i></button>
    </div>
${items}
  </div>
  <div class="pt-3 border-t border-outline-variant/20 flex flex-col gap-2">
    <button onclick="toggleTheme()" class="theme-toggle-btn w-full bg-surface-container text-on-surface hover:bg-surface-variant p-2 rounded-lg flex items-center justify-center gap-2 text-xs font-medium transition-colors"><i class="ph ph-moon text-[18px]"></i><span>Ubah Mode</span></button>
    <a href="generate.html" class="w-full bg-primary text-on-primary rounded-lg py-2.5 font-label-md text-label-md flex justify-center items-center gap-2 hover:bg-primary/90 transition-colors shadow-sm"><i class="ph ph-plus text-[18px]"></i>Buat Novel Baru</a>
  </div>
</aside>`;
}

// ── Process each page ──
for (const [file, src] of Object.entries(map)) {
  const srcPath = path.join(stitch, src);
  if (!fs.existsSync(srcPath)) { console.log(`SKIP ${file} (no stitch source)`); continue; }

  let html = fs.readFileSync(srcPath, 'utf-8');
  const key = file.replace('.html', '');

  // 1. Inject head extras
  html = html.replace('</head>', HEAD_INJECT + '\n</head>');

  // 2. Fix body — remove overflow-hidden and flex
  html = html.replace(/<body[^>]*class="[^"]*"/, '<body class="font-body-md text-body-md text-on-surface antialiased bg-[#f6f6f7] min-h-screen"');

  // 3. Replace header
  html = html.replace(/<header[\s\S]*?<\/header>/, HEADER);

  // 4. Replace nav with sidebar
  html = html.replace(/<nav[\s\S]*?<\/nav>/, makeSidebar(key));

  // 5. Fix main tag — remove fixed height, allow scrolling
  html = html.replace(/<main\s+class="[^"]*"/, '<main class="pt-[68px] px-4 sm:px-6 lg:px-8 pb-24 min-h-screen transition-all duration-300 w-full box-border overflow-x-hidden"');

  // For editor, keep its special layout but still fix overflow
  if (file === 'editor.html') {
    // Editor needs special handling — keep toolbar but fix scroll
    html = html.replace(/<main\s+class="[^"]*"/, '<main class="pt-[68px] pb-20 min-h-screen transition-all duration-300 w-full box-border overflow-x-hidden px-4"');
  }

  fs.writeFileSync(path.join(pub, file), html, 'utf-8');
  console.log(`✅ Fixed ${file}`);
}

// ── Special: Rebuild index.html Bento Grid + Quick Actions + Modals ──
const indexPath = path.join(pub, 'index.html');
let idx = fs.readFileSync(indexPath, 'utf-8');

// Replace bento grid divs with clickable links
idx = idx.replace(
  /<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
  `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-10">
  <a href="library.html" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl p-5 border border-outline-variant/20 shadow-sm hover:border-primary/50 hover:shadow-md transition-all flex flex-col cursor-pointer group">
    <span class="font-label-sm text-label-sm text-outline uppercase mb-2 group-hover:text-primary transition-colors flex items-center justify-between">Total Novels <i class="ph ph-arrow-up-right text-xs"></i></span>
    <span class="font-headline-md text-headline-md text-on-surface">12</span>
  </a>
  <a href="editor.html" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl p-5 border border-outline-variant/20 shadow-sm hover:border-primary/50 hover:shadow-md transition-all flex flex-col cursor-pointer group">
    <span class="font-label-sm text-label-sm text-outline uppercase mb-2 group-hover:text-primary transition-colors flex items-center justify-between">Total Words <i class="ph ph-arrow-up-right text-xs"></i></span>
    <div class="flex items-end gap-2"><span class="font-headline-md text-headline-md text-on-surface">142k</span><span class="font-label-sm text-label-sm text-[#27c93f] mb-1 flex items-center"><i class="ph ph-trend-up text-[14px]"></i> +5k</span></div>
  </a>
  <a href="evaluasi.html" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl p-5 border border-outline-variant/20 shadow-sm hover:border-primary/50 hover:shadow-md transition-all flex flex-col cursor-pointer group">
    <span class="font-label-sm text-label-sm text-outline uppercase mb-2 group-hover:text-primary transition-colors flex items-center justify-between">Avg Score <i class="ph ph-arrow-up-right text-xs"></i></span>
    <span class="font-headline-md text-headline-md text-on-surface">4.8</span>
  </a>
  <a href="seri.html" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl p-5 border border-outline-variant/20 shadow-sm hover:border-primary/50 hover:shadow-md transition-all flex flex-col cursor-pointer group">
    <span class="font-label-sm text-label-sm text-outline uppercase mb-2 group-hover:text-primary transition-colors flex items-center justify-between">Active Series <i class="ph ph-arrow-up-right text-xs"></i></span>
    <span class="font-headline-md text-headline-md text-on-surface">3</span>
  </a>
</div>`
);

// Quick Actions — link buttons to pages/modals
idx = idx.replace(/<button([^>]*>[\s\S]*?Tulis Bab Baru[\s\S]*?<\/button>)/, `<a href="editor.html" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl aspect-square flex flex-col items-center justify-center gap-2 border border-outline-variant/20 shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer"><i class="ph ph-pen-nib text-primary text-[32px]"></i><span class="font-label-md text-label-md text-on-surface">Tulis Bab Baru</span></a>`);
idx = idx.replace(/<button([^>]*>[\s\S]*?Brainstorm Ide[\s\S]*?<\/button>)/, `<button onclick="openModal('brainstorm')" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl aspect-square flex flex-col items-center justify-center gap-2 border border-outline-variant/20 shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer"><i class="ph ph-brain text-secondary text-[32px]"></i><span class="font-label-md text-label-md text-on-surface">Brainstorm Ide</span></button>`);
idx = idx.replace(/<button([^>]*>[\s\S]*?Buat Karakter[\s\S]*?<\/button>)/, `<button onclick="openModal('character')" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl aspect-square flex flex-col items-center justify-center gap-2 border border-outline-variant/20 shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer"><i class="ph ph-user-plus text-tertiary text-[32px]"></i><span class="font-label-md text-label-md text-on-surface">Buat Karakter</span></button>`);
idx = idx.replace(/<button([^>]*>[\s\S]*?Bangun Dunia[\s\S]*?<\/button>)/, `<button onclick="openModal('world')" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl aspect-square flex flex-col items-center justify-center gap-2 border border-outline-variant/20 shadow-sm hover:bg-surface-container-low transition-colors cursor-pointer"><i class="ph ph-planet text-outline text-[32px]"></i><span class="font-label-md text-label-md text-on-surface">Bangun Dunia</span></button>`);

// Lanjutkan button -> editor link
idx = idx.replace(/<button([^>]*>[\s\S]*?Lanjutkan[\s\S]*?<\/button>)/, `<a href="editor.html" class="bg-primary text-on-primary px-6 py-2.5 rounded-lg font-label-md text-label-md hover:bg-primary/90 transition-colors shadow-sm inline-flex items-center gap-2"><i class="ph ph-play text-[18px]"></i>Lanjutkan Editor</a>`);

// Lihat Semua -> library
idx = idx.replace(/href="#">Lihat Semua<\/a>/, `href="library.html" class="font-label-md text-label-md text-primary hover:underline flex items-center gap-1">Lihat Semua <i class="ph ph-arrow-right"></i></a>`);

// Novel cards clickable
idx = idx.replace(/<div class="bg-surface-container-lowest\/80 backdrop-blur-md rounded-xl p-3 border border-outline-variant\/20 shadow-sm hover:shadow-md transition-shadow group cursor-pointer">/g, '<a href="editor.html" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl p-3 border border-outline-variant/20 shadow-sm hover:shadow-md transition-shadow group cursor-pointer block">');
// Fix matching closing divs for novel items (3 items)
for (let i = 0; i < 3; i++) {
  idx = idx.replace(/<\/div>\s*\n<!-- Item/, '</a>\n<!-- Item');
}
idx = idx.replace(/<\/div>\s*\n<!-- Item 4/, '</a>\n<!-- Item 4');

// Buat Baru card -> generate
idx = idx.replace(/<div class="bg-surface-container-lowest\/80 backdrop-blur-md rounded-xl p-3 border border-outline-variant\/20 shadow-sm hover:shadow-md transition-shadow group cursor-pointer flex flex-col items-center justify-center border-dashed">/, '<a href="generate.html" class="bg-surface-container-lowest/80 backdrop-blur-md rounded-xl p-3 border border-outline-variant/20 shadow-sm hover:shadow-md transition-shadow group cursor-pointer flex flex-col items-center justify-center border-dashed block">');

// Replace Material icon with Phosphor for add_circle
idx = idx.replace(/<span class="material-symbols-outlined text-outline text-\[48px\] mb-2">add_circle<\/span>/, '<i class="ph ph-plus-circle text-outline text-[48px] mb-2"></i>');

// Add modals before </body>
const MODALS = `
<!-- Modal System -->
<div id="modal-overlay" onclick="closeModal()" class="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] hidden"></div>
<div id="modal-brainstorm" class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-lg bg-white dark:bg-[#1e1e24] p-6 rounded-2xl shadow-2xl border border-outline-variant/30 z-[61] hidden">
  <div class="flex justify-between items-center pb-3 border-b border-outline-variant/20 mb-4">
    <h3 class="text-lg font-bold text-on-surface flex items-center gap-2"><i class="ph ph-brain text-primary text-xl"></i> Brainstorm Ide</h3>
    <button onclick="closeModal()" class="p-1 rounded hover:bg-surface-variant text-outline"><i class="ph ph-x text-lg"></i></button>
  </div>
  <p class="text-sm text-on-surface-variant mb-3">Masukkan topik atau kata kunci untuk menghasilkan ide plot:</p>
  <input id="bs-topic" type="text" placeholder="cth. Detektif di kota cyberpunk..." class="w-full p-3 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm outline-none mb-3" />
  <div id="bs-result" class="hidden p-3 rounded-lg bg-surface-container text-sm mb-3"></div>
  <div class="flex justify-end gap-2"><button onclick="closeModal()" class="px-4 py-2 rounded-lg text-sm bg-surface-container">Batal</button><button onclick="document.getElementById('bs-result').classList.remove('hidden');document.getElementById('bs-result').innerHTML='<p class=font-semibold>✨ Ide:</p><p>Sebuah penemuan kuno yang mengubah dunia...</p>'" class="px-4 py-2 rounded-lg text-sm bg-primary text-white font-semibold"><i class="ph ph-magic-wand"></i> Hasilkan</button></div>
</div>
<div id="modal-character" class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-lg bg-white dark:bg-[#1e1e24] p-6 rounded-2xl shadow-2xl border border-outline-variant/30 z-[61] hidden">
  <div class="flex justify-between items-center pb-3 border-b border-outline-variant/20 mb-4">
    <h3 class="text-lg font-bold text-on-surface flex items-center gap-2"><i class="ph ph-user-plus text-secondary text-xl"></i> Buat Karakter</h3>
    <button onclick="closeModal()" class="p-1 rounded hover:bg-surface-variant text-outline"><i class="ph ph-x text-lg"></i></button>
  </div>
  <input type="text" placeholder="Peran (cth. Protagonis)" class="w-full p-3 rounded-lg border border-outline-variant bg-surface text-sm outline-none mb-3" />
  <textarea placeholder="Sifat / latar belakang..." class="w-full p-3 rounded-lg border border-outline-variant bg-surface text-sm outline-none h-20 resize-none mb-3"></textarea>
  <div class="flex justify-end gap-2"><button onclick="closeModal()" class="px-4 py-2 rounded-lg text-sm bg-surface-container">Batal</button><button onclick="alert('Karakter disimpan!');closeModal()" class="px-4 py-2 rounded-lg text-sm bg-secondary text-white font-semibold"><i class="ph ph-floppy-disk"></i> Simpan</button></div>
</div>
<div id="modal-world" class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-lg bg-white dark:bg-[#1e1e24] p-6 rounded-2xl shadow-2xl border border-outline-variant/30 z-[61] hidden">
  <div class="flex justify-between items-center pb-3 border-b border-outline-variant/20 mb-4">
    <h3 class="text-lg font-bold text-on-surface flex items-center gap-2"><i class="ph ph-planet text-tertiary text-xl"></i> Bangun Dunia</h3>
    <button onclick="closeModal()" class="p-1 rounded hover:bg-surface-variant text-outline"><i class="ph ph-x text-lg"></i></button>
  </div>
  <input type="text" placeholder="Nama Dunia (cth. Kerajaan Astraria)" class="w-full p-3 rounded-lg border border-outline-variant bg-surface text-sm outline-none mb-3" />
  <textarea placeholder="Aturan sihir, budaya..." class="w-full p-3 rounded-lg border border-outline-variant bg-surface text-sm outline-none h-24 resize-none mb-3"></textarea>
  <div class="flex justify-end gap-2"><button onclick="closeModal()" class="px-4 py-2 rounded-lg text-sm bg-surface-container">Batal</button><button onclick="alert('Dunia disimpan!');closeModal()" class="px-4 py-2 rounded-lg text-sm bg-tertiary text-white font-semibold"><i class="ph ph-floppy-disk"></i> Simpan</button></div>
</div>
<script>
function openModal(name) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-' + name).classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelectorAll('[id^="modal-"]').forEach(el => { if (el.id !== 'modal-overlay') el.classList.add('hidden'); });
}
</script>
`;
idx = idx.replace('</body>', MODALS + '\n</body>');

fs.writeFileSync(indexPath, idx, 'utf-8');
console.log('✅ index.html fully rebuilt with modals + linked cards');

console.log('\n── Audit Complete ──');
