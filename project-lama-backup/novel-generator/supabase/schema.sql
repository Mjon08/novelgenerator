-- ═══════════════════════════════════════════════════════════════════════════
-- novelGENerator — Skema Postgres untuk Supabase
--
-- Konversi dari database/schema.sql (SQLite). Jalankan file ini di
-- Supabase Dashboard > SQL Editor > New Query, lalu klik Run.
--
-- Aman dijalankan berulang: semua perintah memakai IF NOT EXISTS / OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ekstensi vector untuk pencarian kemiripan embedding (RAG).
create extension if not exists vector;

-- ── Perpustakaan RAG ─────────────────────────────────────────────────────────

create table if not exists novels (
  id bigint generated always as identity primary key,
  title text not null,
  author text,
  year integer,
  tags text,
  full_text text,
  file_path text,
  chunk_count integer default 0,
  status text default 'processing',
  -- Sebelumnya ditambahkan lewat ALTER TABLE saat boot server (pola SQLite);
  -- di Postgres kolom harus didefinisikan di sini karena tidak ada DDL ad-hoc
  -- dari client saat runtime.
  is_in_library boolean default false,
  created_at timestamptz default now()
);

-- Kolom untuk berkas asli (docx/pdf/txt) di Supabase Storage, ditambahkan
-- setelah tabel novels pertama kali dibuat. "add column if not exists" aman
-- dijalankan ulang baik di database baru maupun yang sudah lebih dulu ada.
alter table if exists novels add column if not exists storage_path text;

-- Bucket privat untuk berkas novel asli. Privat: hanya server (Service Role
-- Key) yang bisa baca/tulis langsung; akses pengguna lewat signed URL
-- sementara yang dibuatkan server, bukan URL publik permanen.
insert into storage.buckets (id, name, public)
values ('novels', 'novels', false)
on conflict (id) do nothing;

create table if not exists style_profiles (
  id bigint generated always as identity primary key,
  novel_id bigint references novels(id) on delete cascade,
  writing_style text,
  sentence_rhythm text,
  pov text,
  tone text,
  themes text,
  vocabulary_level text,
  genre_tags text,
  signature_phrases text,
  sample_paragraph text,
  raw_json text,
  created_at timestamptz default now()
);

-- Dimensi 384 = keluaran model embedding Xenova/all-MiniLM-L6-v2 (lihat ingest.js).
create table if not exists chunks (
  id bigint generated always as identity primary key,
  novel_id bigint references novels(id) on delete cascade,
  chunk_index integer,
  text text not null,
  embedding vector(384),
  created_at timestamptz default now()
);

create index if not exists idx_chunks_novel_id on chunks(novel_id);
create index if not exists idx_style_novel_id on style_profiles(novel_id);

-- Indeks ANN untuk pencarian kemiripan cepat. Aman dibuat sebelum ada data;
-- kualitas indeks membaik setelah tabel terisi cukup banyak baris.
create index if not exists idx_chunks_embedding on chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ── Evaluasi ─────────────────────────────────────────────────────────────────

create table if not exists eval_results (
  id bigint generated always as identity primary key,
  novel_id text not null,
  total_score integer,
  grade text,
  verdict text,
  style_score integer,
  style_json text,
  quality_score integer,
  quality_json text,
  originality_score integer,
  originality_json text,
  weakest_chapter integer,
  retry_count integer default 0,
  created_at timestamptz default now()
);

create index if not exists idx_eval_novel_id on eval_results(novel_id);

-- ── Novel Hasil Generate ─────────────────────────────────────────────────────
-- Sebelumnya disimpan sebagai berkas JSON di folder lokal novels/ — hilang
-- tiap redeploy di hosting dengan disk ephemeral (Render, Railway, Fly.io,
-- dst.). ID tetap UUID (dibuat di Node lewat uuidv4(), bukan oleh Postgres)
-- supaya kompatibel dengan id yang sudah beredar di eval_results.novel_id.

create table if not exists generated_novels (
  id uuid primary key,
  title text not null,
  genre text,
  theme text,
  outline text,
  chapters jsonb,
  dna_id bigint references novel_dna(id) on delete set null,
  source_title text,
  generation_config jsonb,
  originality jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_generated_novels_created on generated_novels(created_at desc);

-- ── DNA Gaya Penulisan ───────────────────────────────────────────────────────

create table if not exists novel_dna (
  id bigint generated always as identity primary key,
  novel_id bigint references novels(id) on delete set null,
  source_title text not null,
  language_json text,
  style_json text,
  structure_json text,
  character_json text,
  human_touch_json text,
  thematic_json text,
  full_dna_json text,
  -- DNA Blueprint terstruktur (9 kategori) hasil pipeline hierarkis.
  blueprint_json text,
  -- Naskah sumber yang sudah dibersihkan, dipakai memeriksa orisinalitas
  -- novel yang dihasilkan dari DNA ini.
  source_text text,
  word_count integer,
  created_at timestamptz default now()
);

create index if not exists idx_dna_novel_id on novel_dna(novel_id);

-- ── Editor ───────────────────────────────────────────────────────────────────

create table if not exists dokumen_editor (
  id bigint generated always as identity primary key,
  novel_id text,
  judul text not null,
  konten_delta text,
  konten_html text,
  konten_teks text,
  jumlah_kata integer default 0,
  jumlah_bab integer default 0,
  terakhir_diedit timestamptz default now(),
  dibuat_pada timestamptz default now()
);

create table if not exists riwayat_revisi (
  id bigint generated always as identity primary key,
  dokumen_id bigint references dokumen_editor(id) on delete cascade,
  snapshot_delta text,
  snapshot_html text,
  jumlah_kata integer,
  catatan text,
  disimpan_pada timestamptz default now()
);

create table if not exists bab_dokumen (
  id bigint generated always as identity primary key,
  dokumen_id bigint references dokumen_editor(id) on delete cascade,
  nomor_bab integer,
  judul_bab text,
  konten_delta text,
  konten_html text,
  jumlah_kata integer default 0,
  urutan integer,
  terakhir_diedit timestamptz default now()
);

create index if not exists idx_bab_dokumen_id on bab_dokumen(dokumen_id);
create index if not exists idx_revisi_dokumen_id on riwayat_revisi(dokumen_id);

-- ── Seri & Jilid ─────────────────────────────────────────────────────────────

create table if not exists seri (
  id bigint generated always as identity primary key,
  judul text not null,
  deskripsi text,
  genre text,
  status text default 'aktif',
  dibuat_pada timestamptz default now()
);

create table if not exists jilid (
  id bigint generated always as identity primary key,
  seri_id bigint references seri(id) on delete cascade,
  nomor integer not null,
  judul text not null,
  deskripsi text,
  novel_id text,
  status text default 'belum_dimulai',
  dibuat_pada timestamptz default now()
);

create table if not exists story_bible (
  id bigint generated always as identity primary key,
  seri_id bigint references seri(id) on delete cascade,
  tipe text not null,
  nama text not null,
  deskripsi text,
  detail_json text,
  dibuat_pada timestamptz default now()
);

create table if not exists pengaturan_aplikasi (
  kunci text primary key,
  nilai text,
  diperbarui_pada timestamptz default now()
);

create index if not exists idx_jilid_seri_id on jilid(seri_id);
create index if not exists idx_story_bible_seri_id on story_bible(seri_id);

-- ── Pelacak Kuota API ────────────────────────────────────────────────────────
-- Sebelumnya dibuat ad-hoc oleh usageLimiter.js saat runtime; di Postgres
-- tabel harus sudah ada lebih dulu karena tidak ada eksekusi DDL dari client.

create table if not exists api_usage_logs (
  id bigint generated always as identity primary key,
  date_str text not null,
  calls_count integer default 0,
  estimated_cost_usd double precision default 0.0,
  updated_at timestamptz default now()
);

create unique index if not exists idx_usage_date on api_usage_logs(date_str);

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNGSI RPC
--
-- Pencarian kemiripan vektor tidak bisa diekspresikan lewat query builder
-- supabase-js (PostgREST tidak mengekspos operator jarak vektor), jadi
-- dibungkus sebagai fungsi database dan dipanggil lewat supabase.rpc(...).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function match_novel_chunks(
  query_embedding vector(384),
  match_count int default 8
)
returns table (
  id bigint,
  novel_id bigint,
  chunk_index integer,
  text text,
  similarity double precision
)
language sql stable
as $$
  select
    c.id,
    c.novel_id,
    c.chunk_index,
    c.text,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
