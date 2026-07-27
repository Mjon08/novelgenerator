/*
 * NOVEL HASIL GENERATE
 *
 * Menggantikan berkas JSON di folder lokal novels/ — folder itu hidup di
 * disk ephemeral pada kebanyakan hosting (Render, Railway, Fly.io, dst.) dan
 * akan kosong lagi setiap redeploy/restart. Novel hasil generate (Generate
 * AI, Generate dari DNA, Tiru Gaya) disimpan di tabel generated_novels
 * Supabase supaya bertahan lintas deploy.
 *
 * Bentuk objek JS yang dipakai di seluruh server.js dipertahankan sama
 * seperti bentuk JSON lama ({ id, title, genre, ..., createdAt }) — hanya
 * baris created_at <-> createdAt yang dipetakan di sini, sehingga endpoint
 * yang memanggilnya tidak perlu berubah bentuk datanya.
 */

const { getSupabase, throwIfError } = require('./supabaseClient');

function toDbRow(novel) {
  return {
    id: novel.id,
    title: novel.title,
    genre: novel.genre || null,
    theme: novel.theme || null,
    outline: novel.outline || null,
    chapters: novel.chapters || [],
    dna_id: novel.dna_id || null,
    source_title: novel.source_title || null,
    generation_config: novel.generation_config || null,
    originality: novel.originality || null,
    created_at: novel.createdAt || new Date().toISOString()
  };
}

function fromDbRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    genre: row.genre,
    theme: row.theme,
    outline: row.outline,
    chapters: row.chapters || [],
    dna_id: row.dna_id,
    source_title: row.source_title,
    generation_config: row.generation_config,
    originality: row.originality,
    createdAt: row.created_at
  };
}

async function saveGeneratedNovel(novel) {
  const db = getSupabase();
  const result = await db.from('generated_novels').insert(toDbRow(novel));
  throwIfError(result, 'generatedNovels:save');
}

async function getGeneratedNovel(id) {
  const db = getSupabase();
  const result = await db.from('generated_novels').select('*').eq('id', id).maybeSingle();
  const row = throwIfError(result, 'generatedNovels:get');
  return fromDbRow(row);
}

async function listGeneratedNovels() {
  const db = getSupabase();
  const result = await db
    .from('generated_novels')
    .select('id, title, genre, created_at, chapters')
    .order('created_at', { ascending: false });
  const rows = throwIfError(result, 'generatedNovels:list');
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    genre: r.genre,
    createdAt: r.created_at,
    chapterCount: r.chapters?.length || 0
  }));
}

async function deleteGeneratedNovel(id) {
  const db = getSupabase();
  const result = await db.from('generated_novels').delete().eq('id', id).select('id').maybeSingle();
  const deleted = throwIfError(result, 'generatedNovels:delete');
  return Boolean(deleted);
}

module.exports = { saveGeneratedNovel, getGeneratedNovel, listGeneratedNovels, deleteGeneratedNovel };
