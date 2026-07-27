/*
 * SUPABASE STORAGE — berkas novel asli
 *
 * File hasil upload (docx/pdf/txt) disalin ke bucket privat "novels" agar
 * tidak hilang saat server redeploy/restart (disk lokal folder uploads/
 * bersifat sementara). Salinan lokal tetap dipakai sebagai cache cepat;
 * bucket ini adalah sumber kebenaran jangka panjang.
 *
 * Bucket bersifat privat — akses hanya lewat Service Role Key (server) atau
 * signed URL sementara, tidak ada URL publik permanen.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getSupabase } = require('./supabaseClient');

const BUCKET = 'novels';

const MIME_BY_EXT = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

/**
 * Mengunggah berkas lokal ke bucket "novels", ditata per novelId agar mudah
 * ditelusuri dan tidak bentrok antar novel.
 */
async function uploadNovelFile(novelId, localPath, originalName) {
  const db = getSupabase();
  const ext = path.extname(originalName || localPath).toLowerCase();
  const storagePath = `novel-${novelId}/original${ext}`;
  const buffer = fs.readFileSync(localPath);

  const { error } = await db.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: MIME_BY_EXT[ext] || 'application/octet-stream',
    upsert: true
  });
  if (error) throw new Error(`Gagal mengunggah berkas ke Supabase Storage: ${error.message}`);

  return storagePath;
}

/**
 * Mengunduh berkas dari storage ke berkas sementara lokal, dipakai sebagai
 * fallback ketika salinan lokal di uploads/ sudah tidak ada (mis. setelah
 * redeploy). Pemanggil bertanggung jawab menghapus berkas sementara ini
 * setelah selesai dipakai.
 */
async function downloadNovelFile(storagePath) {
  const db = getSupabase();
  const { data, error } = await db.storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(`Gagal mengunduh berkas dari Supabase Storage: ${error.message}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  const ext = path.extname(storagePath) || '';
  const tempPath = path.join(os.tmpdir(), `novelgen-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
}

/**
 * Memastikan ada berkas lokal yang bisa dibaca untuk sebuah novel: pakai
 * cache lokal (file_path) bila masih ada, kalau tidak unduh dari storage.
 * Mengembalikan { path, isTemp } — isTemp menandai file itu perlu dihapus
 * setelah dipakai karena hanya salinan sementara.
 */
async function resolveNovelFilePath(novel) {
  if (novel.file_path && fs.existsSync(novel.file_path)) {
    return { path: novel.file_path, isTemp: false };
  }
  if (novel.storage_path) {
    const tempPath = await downloadNovelFile(novel.storage_path);
    return { path: tempPath, isTemp: true };
  }
  throw new Error('Berkas novel tidak ditemukan — tidak ada salinan lokal maupun di Supabase Storage');
}

/**
 * Signed URL sementara untuk melihat/mengunduh berkas asli dari browser,
 * karena bucket privat tidak punya URL publik permanen.
 */
async function getSignedUrl(storagePath, expiresInSeconds = 3600) {
  const db = getSupabase();
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw new Error(`Gagal membuat signed URL: ${error.message}`);
  return data.signedUrl;
}

async function deleteNovelFile(storagePath) {
  if (!storagePath) return;
  const db = getSupabase();
  const { error } = await db.storage.from(BUCKET).remove([storagePath]);
  if (error) console.error('Gagal menghapus berkas di Supabase Storage:', error.message);
}

module.exports = { uploadNovelFile, downloadNovelFile, resolveNovelFilePath, getSignedUrl, deleteNovelFile, BUCKET };
