CREATE TABLE IF NOT EXISTS novels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  year INTEGER,
  tags TEXT,
  full_text TEXT,
  file_path TEXT,
  chunk_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS style_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER REFERENCES novels(id) ON DELETE CASCADE,
  writing_style TEXT,
  sentence_rhythm TEXT,
  pov TEXT,
  tone TEXT,
  themes TEXT,
  vocabulary_level TEXT,
  genre_tags TEXT,
  signature_phrases TEXT,
  sample_paragraph TEXT,
  raw_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER REFERENCES novels(id) ON DELETE CASCADE,
  chunk_index INTEGER,
  text TEXT NOT NULL,
  embedding BLOB,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chunks_novel_id ON chunks(novel_id);
CREATE INDEX IF NOT EXISTS idx_style_novel_id ON style_profiles(novel_id);

CREATE TABLE IF NOT EXISTS eval_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id TEXT NOT NULL,
  total_score INTEGER,
  grade TEXT,
  verdict TEXT,
  style_score INTEGER,
  style_json TEXT,
  quality_score INTEGER,
  quality_json TEXT,
  originality_score INTEGER,
  originality_json TEXT,
  weakest_chapter INTEGER,
  retry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eval_novel_id ON eval_results(novel_id);

CREATE TABLE IF NOT EXISTS novel_dna (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER REFERENCES novels(id) ON DELETE SET NULL,
  source_title TEXT NOT NULL,
  language_json TEXT,
  style_json TEXT,
  structure_json TEXT,
  character_json TEXT,
  human_touch_json TEXT,
  thematic_json TEXT,
  full_dna_json TEXT,
  -- DNA Blueprint terstruktur (9 kategori) hasil pipeline hierarkis.
  -- Kosong untuk profil hasil ekstraksi versi lama.
  blueprint_json TEXT,
  -- Naskah sumber yang sudah dibersihkan, dipakai memeriksa orisinalitas
  -- novel yang dihasilkan dari DNA ini.
  source_text TEXT,
  word_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dna_novel_id ON novel_dna(novel_id);

-- ── Editor Tables ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dokumen_editor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id TEXT,
  judul TEXT NOT NULL,
  konten_delta TEXT,
  konten_html TEXT,
  konten_teks TEXT,
  jumlah_kata INTEGER DEFAULT 0,
  jumlah_bab INTEGER DEFAULT 0,
  terakhir_diedit DATETIME DEFAULT CURRENT_TIMESTAMP,
  dibuat_pada DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS riwayat_revisi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dokumen_id INTEGER REFERENCES dokumen_editor(id) ON DELETE CASCADE,
  snapshot_delta TEXT,
  snapshot_html TEXT,
  jumlah_kata INTEGER,
  catatan TEXT,
  disimpan_pada DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bab_dokumen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dokumen_id INTEGER REFERENCES dokumen_editor(id) ON DELETE CASCADE,
  nomor_bab INTEGER,
  judul_bab TEXT,
  konten_delta TEXT,
  konten_html TEXT,
  jumlah_kata INTEGER DEFAULT 0,
  urutan INTEGER,
  terakhir_diedit DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bab_dokumen_id ON bab_dokumen(dokumen_id);
CREATE INDEX IF NOT EXISTS idx_revisi_dokumen_id ON riwayat_revisi(dokumen_id);

-- ── Seri & Jilid Tables ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS seri (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judul TEXT NOT NULL,
  deskripsi TEXT,
  genre TEXT,
  status TEXT DEFAULT 'aktif',
  dibuat_pada DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jilid (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seri_id INTEGER REFERENCES seri(id) ON DELETE CASCADE,
  nomor INTEGER NOT NULL,
  judul TEXT NOT NULL,
  deskripsi TEXT,
  novel_id TEXT,
  status TEXT DEFAULT 'belum_dimulai',
  dibuat_pada DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS story_bible (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seri_id INTEGER REFERENCES seri(id) ON DELETE CASCADE,
  tipe TEXT NOT NULL,
  nama TEXT NOT NULL,
  deskripsi TEXT,
  detail_json TEXT,
  dibuat_pada DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pengaturan_aplikasi (
  kunci TEXT PRIMARY KEY,
  nilai TEXT,
  diperbarui_pada DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jilid_seri_id ON jilid(seri_id);
CREATE INDEX IF NOT EXISTS idx_story_bible_seri_id ON story_bible(seri_id);
