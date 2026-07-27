const fs = require('fs');
const path = require('path');

const pub = '/Users/muhammadjon/novel-generator-ai-agent-main/project-lama-backup/novel-generator/public';

// ── Shared Replacements ──
const sharedReplacements = [
  // Nav & Header & Tooltips
  ['title="Toggle Sidebar"', 'title="Buka/Tutup Sidebar"'],
  ['title="Dark/Light Mode"', 'title="Mode Gelap/Terang"'],
  ['title="Dark Mode"', 'title="Mode Gelap"'],
  ['title="Light Mode"', 'title="Mode Terang"'],
  ['<i class="ph ph-moon text-[18px]"></i><span>Ubah Mode</span>', '<i class="ph ph-moon text-[18px]"></i><span>Ganti Mode</span>'],
  ['AI Studio', 'Studio AI'],
  ['Dashboard', 'Dasbor'],
  ['Total Novels', 'Total Novel'],
  ['Total Words', 'Total Kata'],
  ['Avg Score', 'Skor Rata-Rata'],
  ['Active Series', 'Seri Aktif'],
  ['Recent Novels', 'Novel Terbaru'],

  // Standard Action Buttons & Terms
  ['>Export Now<', '>Ekspor Sekarang<'],
  ['>Export Project<', '>Ekspor Proyek<'],
  ['>Export PDF<', '>Ekspor PDF<'],
  ['>Export<', '>Ekspor<'],
  ['>Cancel<', '>Batal<'],
  ['>Save Changes<', '>Simpan Perubahan<'],
  ['>Save<', '>Simpan<'],
  ['>Share<', '>Bagikan<'],
  ['>Edit Details<', '>Edit Detail<'],
  ['Draft', 'Draf'],
  ['words', 'kata'],
  ['Sci-Fi', 'Fiksi Ilmiah'],
  ['My Series', 'Seri Saya'],
  ['Untitled Romance', 'Romansa Tanpa Judul'],
  ['Auto-Save', 'Simpan Otomatis'],
  ['Automatically save drafts while generating', 'Simpan draf secara otomatis saat membuat teks'],
];

// File-specific dictionary replacements
const fileReplacements = {
  'index.html': [
    ['Total Novels', 'Total Novel'],
    ['Total Words', 'Total Kata'],
    ['Avg Score', 'Skor Rata-Rata'],
    ['Active Series', 'Seri Aktif'],
  ],
  'editor.html': [
    ['<title>novelGENerator Editor</title>', '<title>Editor - novelGENerator Studio</title>'],
    ['Target Harian:', 'Target Harian:'],
    ['>Bagikan<', '>Bagikan<'],
    ['>Simpan<', '>Simpan<'],
  ],
  'ekspor.html': [
    ['<title>Export Project</title>', '<title>Ekspor Proyek - novelGENerator Studio</title>'],
    ['Export \'The Obsidian Throne\'', 'Ekspor \'Takhta Obsidian\''],
    ['Choose Format', 'Pilih Format'],
    ['Select Chapter Range', 'Pilih Jangkauan Bab'],
    ['All Chapters', 'Semua Bab'],
    ['Include Table of Contents', 'Sertakan Daftar Isi'],
    ['Include Cover Image', 'Sertakan Gambar Sampul'],
    ['Export Progress', 'Progres Ekspor'],
    ['Downloading...', 'Mengunduh...'],
  ],
  'evaluasi.html': [
    ['Top 5% of generated narratives.', '5% Teratas dari narasi yang dihasilkan.'],
    ['Total Score', 'Skor Total'],
    ['High originality score detected. The central conflict presents a novel twist on standard tropes.', 'Skor orisinalitas tinggi terdeteksi. Konflik utama menghadirkan alur cerita unik.'],
    ['Pacing & Flow', 'Ritme & Alur'],
    ['Character Depth', 'Kedalaman Karakter'],
    ['Dialogue Quality', 'Kualitas Dialog'],
    ['World Building', 'Pembangunan Dunia'],
    ['Emotional Impact', 'Dampak Emosional'],
    ['Strengths', 'Keunggulan'],
    ['Areas for Improvement', 'Area Pembaharuan'],
    ['Detailed Analysis', 'Analisis Detail'],
  ],
  'generate.html': [
    ['Chapter 4', 'Bab 4'],
    ['Prompt / Instructions', 'Petunjuk / Prompt'],
    ['Generate Chapter', 'Hasilkan Bab'],
    ['Generating...', 'Menghasilkan...'],
    ['Word Limit', 'Batas Kata'],
    ['Tone & Style', 'Nada & Gaya'],
    ['Plot Outline', 'Garis Besar Plot'],
  ],
  'library.html': [
    ['<title>Library - novelGENerator</title>', '<title>Perpustakaan - novelGENerator Studio</title>'],
    ['Search novels...', 'Cari novel...'],
    ['Filter by Genre', 'Filter Berdasarkan Genre'],
    ['Sort by', 'Urutkan Berdasarkan'],
    ['Last Modified', 'Terakhir Diubah'],
    ['Title (A-Z)', 'Judul (A-Z)'],
    ['Word Count', 'Jumlah Kata'],
  ],
  'mimicry.html': [
    ['<title>Mimicry - novelGENerator</title>', '<title>Tiru Gaya (DNA) - novelGENerator Studio</title>'],
    ['Upload Sample Text', 'Unggah Sampel Teks'],
    ['Analyze Writing Style', 'Analisis Gaya Penulisan'],
    ['Analyzing...', 'Menganalisis...'],
    ['Style Signature', 'Ciri Khas Gaya'],
    ['Sentence Structure', 'Struktur Kalimat'],
    ['Vocabulary Complexity', 'Kompleksitas Kosakata'],
    ['Pacing Score', 'Skor Ritme'],
  ],
  'pengaturan.html': [
    ['<title>Settings - novelGENerator</title>', '<title>Pengaturan - novelGENerator Studio</title>'],
    ['General Settings', 'Pengaturan Umum'],
    ['AI Model Preferences', 'Preferensi Model AI'],
    ['API Keys', 'Kunci API'],
    ['Export Settings', 'Pengaturan Ekspor'],
    ['Appearance', 'Tampilan'],
  ],
  'seri.html': [
    ['<title>novelGENerator - Series Management</title>', '<title>Manajemen Seri - novelGENerator Studio</title>'],
    ['Create New Series', 'Buat Seri Baru'],
    ['Series Title', 'Judul Seri'],
    ['Description', 'Deskripsi'],
    ['Total Volumes', 'Total Jilid'],
  ],
};

const files = fs.readdirSync(pub).filter(f => f.endsWith('.html'));

files.forEach(file => {
  const fp = path.join(pub, file);
  let html = fs.readFileSync(fp, 'utf-8');

  // Apply shared replacements
  sharedReplacements.forEach(([from, to]) => {
    html = html.split(from).join(to);
  });

  // Apply file specific replacements
  if (fileReplacements[file]) {
    fileReplacements[file].forEach(([from, to]) => {
      html = html.split(from).join(to);
    });
  }

  // Update nav js labels inside HTML if present
  html = html.replace(/'Light Mode'/g, "'Mode Terang'").replace(/'Dark Mode'/g, "'Mode Gelap'");

  fs.writeFileSync(fp, html, 'utf-8');
  console.log(`🇮🇩 Translated ${file} to Indonesian`);
});

// Also update nav.js labels
const navJsPath = path.join(pub, 'shared', 'nav.js');
if (fs.existsSync(navJsPath)) {
  let navJs = fs.readFileSync(navJsPath, 'utf-8');
  navJs = navJs.replace(/'Light Mode'/g, "'Mode Terang'").replace(/'Dark Mode'/g, "'Mode Gelap'");
  navJs = navJs.replace(/>Ubah Mode</g, '>Ganti Mode<');
  fs.writeFileSync(navJsPath, navJs, 'utf-8');
  console.log(`🇮🇩 Updated nav.js labels`);
}
