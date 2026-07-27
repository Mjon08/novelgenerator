/* ── novelGENerator Editor JS ─────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────────────
let quill = null;
let dokumenId = null;
let babAktif = null;
let isDirty = false;
let autoSaveTimer = null;
let lastAutoSnap = 0;
let aiKelanjutanTeks = '';
let aiKelanjutanRange = null;
let dailyTarget = parseInt(localStorage.getItem('dailyTarget') || '0');
let dailyStart = parseInt(localStorage.getItem('dailyStart') || '0');
let sidebarVisible = true;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initQuill();
  initKeyboardShortcuts();
  initAutoSave();
  applyPreferences();

  // URL params: ?id=123 (buka dokumen) atau ?novel_id=abc (impor dari novel)
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const novelId = params.get('novel_id');
  const novelTitle = params.get('title');

  if (id) {
    await bukaDokumen(parseInt(id));
  } else if (novelId) {
    await impordariNovel(novelId, novelTitle);
  } else {
    // Coba muat draft IndexedDB terakhir
    await muatDraftIDB();
  }
});

// ── Quill Setup ───────────────────────────────────────────────────────────────
function initQuill() {
  quill = new Quill('#quill-editor', {
    theme: 'snow',
    modules: {
      toolbar: false, // we use our own toolbar
      history: { delay: 1000, maxStack: 100 },
    },
    formats: ['bold','italic','underline','strike','header','align','list','blockquote','indent','font','size','color','background'],
  });

  // Track selection for AI floating toolbar
  quill.on('selection-change', (range) => {
    if (range && range.length > 0) {
      tampilkanAiFloatToolbar(range);
    } else {
      sembunyikanAiFloatToolbar();
    }
    perbaruiToolbarState();
  });

  // Track changes
  quill.on('text-change', () => {
    isDirty = true;
    perbaruiStatusBar();
    simpanKeIDB();
  });
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 's': e.preventDefault(); simpanManual(); break;
        case 'f': e.preventDefault(); toggleFindReplace(); break;
        case 'b': e.preventDefault(); quill.format('bold', !quill.getFormat().bold); break;
        case 'i': e.preventDefault(); quill.format('italic', !quill.getFormat().italic); break;
        case 'u': e.preventDefault(); quill.format('underline', !quill.getFormat().underline); break;
      }
    }
    if (e.key === 'F11') { e.preventDefault(); toggleFocusMode(); }
    if (e.key === 'Escape') {
      if (document.body.classList.contains('focus-mode')) toggleFocusMode();
      batalKelanjutan();
      sembunyikanAiFloatToolbar();
    }
  });
}

function initAutoSave() {
  autoSaveTimer = setInterval(async () => {
    if (isDirty && dokumenId) {
      await simpanKeSever();
    }
  }, 30000); // 30 detik
}

function applyPreferences() {
  if (localStorage.getItem('darkMode') === '1') {
    document.body.classList.add('dark');
  }
  if (dailyTarget > 0) {
    document.getElementById('word-target-section').style.display = 'flex';
  }
}

// ── IndexedDB Draft Cache ──────────────────────────────────────────────────────
async function bukaIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('novelgen-editor', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('drafts', { keyPath: 'id' });
    };
    req.onsuccess = (e) => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}

async function simpanKeIDB() {
  try {
    const db = await bukaIDB();
    const tx = db.transaction('drafts', 'readwrite');
    tx.objectStore('drafts').put({
      id: dokumenId || 'unsaved',
      delta: JSON.stringify(quill.getContents()),
      html: quill.root.innerHTML,
      judul: document.getElementById('doc-title-input').value,
      waktu: Date.now()
    });
  } catch (_) {}
}

async function muatDraftIDB() {
  try {
    const db = await bukaIDB();
    const tx = db.transaction('drafts', 'readonly');
    const req = tx.objectStore('drafts').get('unsaved');
    req.onsuccess = (e) => {
      const draft = e.target.result;
      if (draft?.delta) {
        const usia = Date.now() - draft.waktu;
        if (usia < 24 * 60 * 60 * 1000) { // < 24 jam
          quill.setContents(JSON.parse(draft.delta));
          if (draft.judul) document.getElementById('doc-title-input').value = draft.judul;
          perbaruiStatusBar();
          tampilToast('Draft lokal dimuat', 'success');
        }
      }
    };
  } catch (_) {}
}

// ── Dokumen ────────────────────────────────────────────────────────────────────
async function bukaDokumen(id) {
  try {
    const resp = await fetch(`/api/editor/dokumen/${id}`);
    if (!resp.ok) throw new Error('Gagal memuat dokumen');
    const dok = await resp.json();
    dokumenId = id;
    document.getElementById('doc-title-input').value = dok.judul;

    if (dok.konten_html) {
      quill.root.innerHTML = dok.konten_html;
    } else {
      quill.setContents([{ insert: '\n' }]);
    }

    renderChapterList(dok.bab || []);
    perbaruiStatusBar();
    isDirty = false;
    setAutosaveStatus('saved', 'Tersimpan');
    document.title = `${dok.judul} — novelGENerator Editor`;
  } catch (err) {
    tampilToast('Gagal memuat dokumen: ' + err.message, 'error');
  }
}

async function impordariNovel(novelId, judul) {
  bukaModalBaru();
  document.getElementById('baru-judul').value = judul || 'Novel Baru';
  // Set select ke novel ini
  await muatDaftarNovelBaru();
  const sel = document.getElementById('baru-novel-select');
  for (const opt of sel.options) {
    if (opt.value === novelId) { opt.selected = true; break; }
  }
}

async function buatDokumenBaru() {
  const judul = document.getElementById('baru-judul').value.trim();
  if (!judul) { tampilToast('Judul wajib diisi', 'error'); return; }
  const novel_id = document.getElementById('baru-novel-select').value || null;

  try {
    const resp = await fetch('/api/editor/dokumen/baru', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judul, novel_id })
    });
    const data = await resp.json();
    if (!data.sukses) throw new Error(data.error);
    tutupModal('modal-baru');
    window.location.href = `/editor.html?id=${data.dokumen_id}`;
  } catch (err) {
    tampilToast('Gagal membuat dokumen: ' + err.message, 'error');
  }
}

async function simpanManual() {
  if (!dokumenId) {
    bukaModalBaru();
    return;
  }
  await simpanKeSever(true);
}

async function simpanKeSever(manual = false) {
  setAutosaveStatus('saving', 'Menyimpan...');
  try {
    const konten_html = quill.root.innerHTML;
    const konten_teks = quill.getText();
    const konten_delta = JSON.stringify(quill.getContents());

    const resp = await fetch(`/api/editor/dokumen/${dokumenId}/simpan`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ konten_delta, konten_html, konten_teks })
    });
    const data = await resp.json();
    if (!data.sukses) throw new Error(data.error);

    isDirty = false;
    const waktu = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    setAutosaveStatus('saved', `Tersimpan ${waktu}`);
    document.getElementById('stat-saved').textContent = waktu;
    if (manual) tampilToast('Dokumen tersimpan', 'success');
    await simpanKeIDB();
  } catch (err) {
    setAutosaveStatus('error', 'Gagal menyimpan');
    if (manual) tampilToast('Gagal menyimpan: ' + err.message, 'error');
  }
}

function setAutosaveStatus(status, teks) {
  const el = document.getElementById('autosave-indicator');
  el.className = status;
  document.getElementById('autosave-text').textContent = teks;
}

async function gantiJudulDokumen(judul) {
  document.title = `${judul} — novelGENerator Editor`;
  if (!dokumenId) return;
  // Update via save (judul dikirim di endpoint /simpan sudah cukup melalui re-render)
  isDirty = true;
}

// ── Bab ────────────────────────────────────────────────────────────────────────
function renderChapterList(daftarBab) {
  const el = document.getElementById('chapter-list');
  el.innerHTML = '';
  document.getElementById('stat-chapters').textContent = daftarBab.length;

  daftarBab.forEach((bab) => {
    const div = document.createElement('div');
    div.className = 'chapter-item' + (bab.id === babAktif ? ' active' : '');
    div.dataset.id = bab.id;
    div.innerHTML = `
      <span class="ch-num">${bab.nomor_bab}</span>
      <span class="ch-title" title="${bab.judul_bab}">${bab.judul_bab}</span>
      <span class="ch-words">${(bab.jumlah_kata || 0).toLocaleString()}</span>
    `;
    div.ondblclick = () => editJudulBab(bab.id, bab.judul_bab);
    div.onclick = () => navigasiBab(bab);
    el.appendChild(div);
  });
}

async function tambahBab() {
  if (!dokumenId) { tampilToast('Simpan dokumen terlebih dahulu', 'error'); return; }
  const judul = prompt('Judul bab baru:');
  if (!judul) return;
  try {
    const resp = await fetch(`/api/editor/dokumen/${dokumenId}/bab/tambah`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judul_bab: judul })
    });
    const data = await resp.json();
    if (!data.sukses) throw new Error(data.error);
    tampilToast('Bab ditambahkan', 'success');
    await muatUlangBab();
  } catch (err) {
    tampilToast('Gagal: ' + err.message, 'error');
  }
}

async function muatUlangBab() {
  if (!dokumenId) return;
  try {
    const resp = await fetch(`/api/editor/dokumen/${dokumenId}`);
    const dok = await resp.json();
    renderChapterList(dok.bab || []);
  } catch (_) {}
}

function navigasiBab(bab) {
  // Scroll ke header bab di editor (cari teks judul)
  babAktif = bab.id;
  document.querySelectorAll('.chapter-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`.chapter-item[data-id="${bab.id}"]`);
  if (el) el.classList.add('active');

  if (bab.konten_html) {
    quill.root.innerHTML = bab.konten_html;
    quill.focus();
  }
}

async function editJudulBab(babId, judulLama) {
  const judulBaru = prompt('Judul bab:', judulLama);
  if (!judulBaru || judulBaru === judulLama) return;
  try {
    await fetch(`/api/editor/bab/${babId}/judul`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judul_bab: judulBaru })
    });
    await muatUlangBab();
  } catch (_) {}
}

function switchSidebarTab(tab, btn) {
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-bab').style.display = tab === 'bab' ? '' : 'none';
  document.getElementById('tab-riwayat').style.display = tab === 'riwayat' ? '' : 'none';
  if (tab === 'riwayat') muatRiwayat();
}

async function muatRiwayat() {
  if (!dokumenId) return;
  try {
    const resp = await fetch(`/api/editor/dokumen/${dokumenId}/riwayat`);
    const data = await resp.json();
    const el = document.getElementById('revision-list');
    el.innerHTML = '';
    (data.riwayat || []).forEach(r => {
      const div = document.createElement('div');
      div.className = 'revision-item';
      const waktu = new Date(r.disimpan_pada).toLocaleString('id-ID');
      div.innerHTML = `<div>${r.catatan || 'Revisi'}</div><div class="rev-time">${waktu} · ${(r.jumlah_kata||0).toLocaleString()} kata</div>`;
      div.onclick = () => konfirmasiRestore(r.id);
      el.appendChild(div);
    });
    if (!data.riwayat?.length) el.innerHTML = '<div style="color:rgba(205,214,244,0.4);font-size:12px;padding:12px">Belum ada riwayat revisi</div>';
  } catch (_) {}
}

async function konfirmasiRestore(revisiId) {
  if (!confirm('Pulihkan ke versi ini? Versi saat ini akan disimpan sebagai revisi baru.')) return;
  try {
    const resp = await fetch(`/api/editor/dokumen/${dokumenId}/restore/${revisiId}`, { method: 'POST' });
    const data = await resp.json();
    if (data.html) quill.root.innerHTML = data.html;
    tampilToast('Dokumen dipulihkan', 'success');
    isDirty = false;
    setAutosaveStatus('saved', 'Dipulihkan');
  } catch (err) {
    tampilToast('Gagal memulihkan: ' + err.message, 'error');
  }
}

// ── Status Bar ─────────────────────────────────────────────────────────────────
function perbaruiStatusBar() {
  const teks = quill.getText();
  const kata = teks.trim().split(/\s+/).filter(Boolean).length;
  const karakter = teks.length;
  document.getElementById('stat-words').textContent = kata.toLocaleString();
  document.getElementById('stat-chars').textContent = karakter.toLocaleString();

  // Target harian
  if (dailyTarget > 0) {
    const added = Math.max(0, kata - dailyStart);
    const pct = Math.min(100, Math.round(added / dailyTarget * 100));
    document.getElementById('target-progress').textContent = `${added}/${dailyTarget}`;
    document.getElementById('word-target-fill').style.width = pct + '%';
  }
}

function perbaruiToolbarState() {
  const fmt = quill.getFormat();
  ['bold','italic','underline','strike'].forEach(f => {
    const btn = document.getElementById(`tb-${f}`);
    if (btn) btn.classList.toggle('active', !!fmt[f]);
  });
}

// ── AI Floating Toolbar ────────────────────────────────────────────────────────
function tampilkanAiFloatToolbar(range) {
  const bounds = quill.getBounds(range.index, range.length);
  const editorRect = document.getElementById('quill-editor').getBoundingClientRect();
  const toolbar = document.getElementById('ai-float-toolbar');
  toolbar.style.left = (editorRect.left + bounds.left) + 'px';
  toolbar.style.top = (editorRect.top + bounds.top - 44) + 'px';
  toolbar.classList.add('visible');
}

function sembunyikanAiFloatToolbar() {
  document.getElementById('ai-float-toolbar').classList.remove('visible');
}

// ── AI: Perbaiki ───────────────────────────────────────────────────────────────
async function aiPerbaiki(gaya = 'netral') {
  const selection = quill.getSelection();
  if (!selection || selection.length === 0) {
    tampilToast('Pilih teks terlebih dahulu', 'error');
    return;
  }
  const teks = quill.getText(selection.index, selection.length);
  sembunyikanAiFloatToolbar();
  setAutosaveStatus('saving', 'AI memproses...');

  try {
    const resp = await fetch('/api/editor/ai/perbaiki', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teks, gaya })
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let hasil = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.teks) hasil += d.teks;
          } catch (_) {}
        }
        if (line.startsWith('event: selesai')) {
          quill.deleteText(selection.index, selection.length);
          quill.insertText(selection.index, hasil, 'ai-class');
          quill.setSelection(selection.index, hasil.length);
          isDirty = true;
          tampilToast('Teks diperbaiki', 'success');
          setAutosaveStatus('saved', 'Diperbaiki');
        }
      }
    }
  } catch (err) {
    tampilToast('Gagal: ' + err.message, 'error');
    setAutosaveStatus('saved', 'Tersimpan');
  }
}

// ── AI: Lanjutkan ──────────────────────────────────────────────────────────────
async function aiLanjutkan() {
  const selection = quill.getSelection() || { index: quill.getLength() - 1, length: 0 };
  const konteksStart = Math.max(0, selection.index - 600);
  const konteks = quill.getText(konteksStart, selection.index - konteksStart);

  aiKelanjutanRange = { index: selection.index, length: 0 };
  aiKelanjutanTeks = '';

  const bar = document.getElementById('ai-continue-bar');
  bar.classList.add('visible');
  document.getElementById('ai-continue-label').textContent = 'Menulis...';
  document.getElementById('ai-spinner').style.display = 'inline-block';

  try {
    const resp = await fetch('/api/editor/ai/lanjutkan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ konteks })
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let insertPos = aiKelanjutanRange.index;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const d = JSON.parse(line.slice(6));
            if (d.teks) {
              aiKelanjutanTeks += d.teks;
              quill.insertText(insertPos, d.teks, { background: '#dbeafe' });
              insertPos += d.teks.length;
              aiKelanjutanRange.length = aiKelanjutanTeks.length;
            }
          } catch (_) {}
        }
        if (line.startsWith('event: selesai')) {
          document.getElementById('ai-spinner').style.display = 'none';
          document.getElementById('ai-continue-label').textContent = `+${aiKelanjutanTeks.split(/\s+/).length} kata`;
        }
      }
    }
  } catch (err) {
    batalKelanjutan();
    tampilToast('Gagal: ' + err.message, 'error');
  }
}

function simpanKelanjutan() {
  if (aiKelanjutanRange) {
    quill.formatText(aiKelanjutanRange.index, aiKelanjutanRange.length, { background: false });
    isDirty = true;
    perbaruiStatusBar();
  }
  document.getElementById('ai-continue-bar').classList.remove('visible');
  aiKelanjutanTeks = '';
  aiKelanjutanRange = null;
  tampilToast('Kelanjutan disimpan', 'success');
}

function batalKelanjutan() {
  if (aiKelanjutanRange && aiKelanjutanTeks) {
    quill.deleteText(aiKelanjutanRange.index, aiKelanjutanTeks.length);
  }
  document.getElementById('ai-continue-bar').classList.remove('visible');
  aiKelanjutanTeks = '';
  aiKelanjutanRange = null;
}

// ── AI: Cek Konsistensi ────────────────────────────────────────────────────────
async function aiCekKonsistensi() {
  if (!dokumenId) { tampilToast('Simpan dokumen terlebih dahulu', 'error'); return; }
  tampilToast('Menganalisis konsistensi...', 'success');
  try {
    const resp = await fetch('/api/editor/ai/cek-konsistensi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        konten_teks: quill.getText(),
        judul: document.getElementById('doc-title-input').value
      })
    });
    const hasil = await resp.json();
    tampilHasilKonsistensi(hasil);
  } catch (err) {
    tampilToast('Gagal: ' + err.message, 'error');
  }
}

function tampilHasilKonsistensi(h) {
  const el = document.getElementById('consistency-result');
  const masalah = (h.masalah || []).map(m => `<li>${m}</li>`).join('');
  const saran = (h.saran || []).map(s => `<li>${s}</li>`).join('');
  el.innerHTML = `
    <div class="score-ring">${h.skor || 0}</div>
    <p style="text-align:center;color:#6b7280;margin-bottom:16px">${h.ringkasan || ''}</p>
    ${masalah ? `<strong>Masalah Ditemukan:</strong><ul style="margin:8px 0 16px">${masalah}</ul>` : '<p style="color:#16a34a">✓ Tidak ada masalah konsistensi ditemukan</p>'}
    ${saran ? `<strong>Saran:</strong><ul>${saran}</ul>` : ''}
  `;
  document.getElementById('consistency-modal').classList.add('open');
}

// ── Ekspor ─────────────────────────────────────────────────────────────────────
async function eksporTxt() {
  if (!dokumenId) {
    const judul = document.getElementById('doc-title-input').value || 'novel';
    const blob = new Blob([quill.getText()], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `${judul}.txt`);
    return;
  }
  window.location.href = `/api/editor/ekspor/txt/${dokumenId}`;
}

async function eksporPdf() {
  if (!dokumenId) { tampilToast('Simpan dokumen terlebih dahulu', 'error'); return; }
  await simpanKeSever();
  window.open(`/api/editor/ekspor/pdf/${dokumenId}`, '_blank');
}

async function eksporDocx() {
  if (typeof eksporKeDocx === 'function') {
    await eksporKeDocx(quill, dokumenId, document.getElementById('doc-title-input').value);
  } else {
    tampilToast('Modul ekspor .docx belum dimuat', 'error');
  }
}

// ── Find & Replace ─────────────────────────────────────────────────────────────
function toggleFindReplace() {
  const el = document.getElementById('find-replace-panel');
  el.classList.toggle('open');
  if (el.classList.contains('open')) document.getElementById('find-input').focus();
}

function cariTeks() {
  const q = document.getElementById('find-input').value;
  if (!q) { document.getElementById('find-count').textContent = ''; return; }
  const teks = quill.getText();
  const matches = [...teks.matchAll(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi'))];
  document.getElementById('find-count').textContent = matches.length ? `${matches.length} hasil` : 'Tidak ditemukan';
}

function gantiSatu() {
  const cari = document.getElementById('find-input').value;
  const ganti = document.getElementById('replace-input').value;
  if (!cari) return;
  const teks = quill.getText();
  const idx = teks.toLowerCase().indexOf(cari.toLowerCase());
  if (idx !== -1) {
    quill.deleteText(idx, cari.length);
    quill.insertText(idx, ganti);
    tampilToast('Teks diganti', 'success');
    cariTeks();
  }
}

function gantiSemua() {
  const cari = document.getElementById('find-input').value;
  const ganti = document.getElementById('replace-input').value;
  if (!cari) return;
  let teks = quill.getText();
  const regex = new RegExp(cari.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
  let count = 0;
  let match;
  const replacements = [];
  while ((match = regex.exec(teks)) !== null) {
    replacements.unshift({ index: match.index, length: match[0].length });
    count++;
  }
  replacements.forEach(({ index, length }) => {
    quill.deleteText(index, length);
    quill.insertText(index, ganti);
  });
  tampilToast(`${count} teks diganti`, 'success');
  cariTeks();
}

// ── Modal helpers ──────────────────────────────────────────────────────────────
function tutupModal(id) {
  document.getElementById(id).classList.remove('open');
}

async function bukaModalBaru() {
  await muatDaftarNovelBaru();
  document.getElementById('modal-baru').classList.add('open');
  document.getElementById('baru-judul').focus();
}

async function muatDaftarNovelBaru() {
  try {
    const resp = await fetch('/api/novels');
    const data = await resp.json();
    const sel = document.getElementById('baru-novel-select');
    sel.innerHTML = '<option value="">— Mulai dari kosong —</option>';
    (data.novels || []).forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = n.title;
      sel.appendChild(opt);
    });
  } catch (_) {}
}

async function bukaModalDaftar() {
  const el = document.getElementById('daftar-dokumen-list');
  el.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>';
  document.getElementById('modal-daftar').classList.add('open');
  try {
    const resp = await fetch('/api/editor/dokumen/daftar');
    const data = await resp.json();
    el.innerHTML = '';
    if (!data.daftar?.length) {
      el.innerHTML = '<p style="color:#6b7280;text-align:center;padding:20px">Belum ada dokumen. Buat dokumen baru terlebih dahulu.</p>';
      return;
    }
    data.daftar.forEach(d => {
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid #f3f4f6;cursor:pointer;border-radius:6px';
      div.onmouseenter = () => div.style.background = '#f9fafb';
      div.onmouseleave = () => div.style.background = '';
      const waktu = new Date(d.terakhir_diedit).toLocaleString('id-ID');
      div.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:600">${d.judul}</div>
          <div style="font-size:12px;color:#6b7280">${(d.jumlah_kata||0).toLocaleString()} kata · ${d.jumlah_bab} bab · ${waktu}</div>
        </div>
        <button onclick="event.stopPropagation();hapusDokumen(${d.id})" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:18px" title="Hapus">🗑</button>
      `;
      div.onclick = () => { tutupModal('modal-daftar'); window.location.href = `/editor.html?id=${d.id}`; };
      el.appendChild(div);
    });
  } catch (err) {
    el.innerHTML = `<p style="color:#dc2626">Gagal memuat: ${err.message}</p>`;
  }
}

async function hapusDokumen(id) {
  if (!confirm('Hapus dokumen ini secara permanen?')) return;
  try {
    await fetch(`/api/editor/dokumen/${id}`, { method: 'DELETE' });
    tampilToast('Dokumen dihapus', 'success');
    bukaModalDaftar();
  } catch (err) {
    tampilToast('Gagal: ' + err.message, 'error');
  }
}

// ── Target Harian ──────────────────────────────────────────────────────────────
function bukaTargetHarian() {
  document.getElementById('target-input').value = dailyTarget || 1000;
  document.getElementById('modal-target').classList.add('open');
}

function simpanTarget() {
  dailyTarget = parseInt(document.getElementById('target-input').value) || 0;
  localStorage.setItem('dailyTarget', dailyTarget);
  const kataSaatIni = quill.getText().trim().split(/\s+/).filter(Boolean).length;
  dailyStart = kataSaatIni;
  localStorage.setItem('dailyStart', dailyStart);
  document.getElementById('word-target-section').style.display = dailyTarget > 0 ? 'flex' : 'none';
  tutupModal('modal-target');
  perbaruiStatusBar();
  tampilToast(`Target ${dailyTarget.toLocaleString()} kata/hari diset`, 'success');
}

// ── UI Toggles ─────────────────────────────────────────────────────────────────
function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  document.getElementById('sidebar').classList.toggle('collapsed', !sidebarVisible);
}

function toggleFocusMode() {
  document.body.classList.toggle('focus-mode');
  if (document.body.classList.contains('focus-mode')) {
    tampilToast('Mode Fokus — Tekan Esc untuk keluar', 'success');
  }
}

function toggleDarkMode() {
  document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', document.body.classList.contains('dark') ? '1' : '0');
}

function toggleMenu(btn) {
  document.querySelectorAll('.menu-btn.open').forEach(b => { if (b !== btn) b.classList.remove('open'); });
  btn.classList.toggle('open');
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-btn')) {
      document.querySelectorAll('.menu-btn.open').forEach(b => b.classList.remove('open'));
    }
  }, { once: true });
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function tampilToast(pesan, tipe = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${tipe}`;
  el.textContent = pesan;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Warn before unload ─────────────────────────────────────────────────────────
window.addEventListener('beforeunload', (e) => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = 'Ada perubahan yang belum tersimpan. Yakin ingin meninggalkan halaman?';
  }
});

