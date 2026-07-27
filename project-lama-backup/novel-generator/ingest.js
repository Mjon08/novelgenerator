const fs = require('fs').promises;
const path = require('path');
const { getSupabase, throwIfError } = require('./database/supabaseClient');

let pipeline;

async function getEmbedder() {
  if (!pipeline) {
    const { pipeline: xPipeline } = await import('@xenova/transformers');
    pipeline = await xPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return pipeline;
}

async function parseFile(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
    return await fs.readFile(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  throw new Error(`Format berkas tidak didukung: ${ext}. Gunakan .txt, .md, .docx, atau .pdf`);
}

function chunkText(text, wordsPerChunk = 300, overlap = 50) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  let i = 0;

  while (i < words.length) {
    const slice = words.slice(i, i + wordsPerChunk);
    if (slice.length < 20) break;
    chunks.push(slice.join(' '));
    i += wordsPerChunk - overlap;
  }

  return chunks;
}

async function embedChunks(chunks) {
  const embedder = await getEmbedder();
  const embeddings = [];

  for (const chunk of chunks) {
    const output = await embedder(chunk, { pooling: 'mean', normalize: true });
    const vec = Array.from(output.data);
    embeddings.push(vec);
  }

  return embeddings;
}

/**
 * Menyimpan chunk beserta embeddingnya.
 *
 * Kolom `embedding` bertipe `vector(384)` di Postgres (lihat supabase/schema.sql).
 * pgvector menerima array angka JS biasa lewat PostgREST — tidak perlu lagi
 * dikonversi ke Buffer biner seperti pada BLOB SQLite sebelumnya.
 */
async function saveToDatabase(novelId, chunks, embeddings) {
  const db = getSupabase();

  const rows = chunks.map((text, i) => ({
    novel_id: novelId,
    chunk_index: i,
    text,
    embedding: embeddings[i]
  }));

  // PostgREST tidak punya transaksi multi-statement dari client; insert massal
  // dalam satu panggilan sudah atomik untuk tabel chunks itu sendiri.
  const insertResult = await db.from('chunks').insert(rows);
  throwIfError(insertResult, 'saveToDatabase:insert');

  const updateResult = await db
    .from('novels')
    .update({ chunk_count: chunks.length })
    .eq('id', novelId);
  throwIfError(updateResult, 'saveToDatabase:updateCount');
}

async function ingestNovel(filePath, meta, onProgress) {
  const { novelId } = meta;

  onProgress?.('parsing_file');
  const text = await parseFile(filePath, meta.mimeType);

  onProgress?.('chunking_text');
  const chunks = chunkText(text);

  onProgress?.('embedding_chunks');
  const embeddings = await embedChunks(chunks);

  onProgress?.('saving_to_db');
  await saveToDatabase(novelId, chunks, embeddings);

  const db = getSupabase();
  const result = await db
    .from('novels')
    .update({ full_text: text, status: 'ingested' })
    .eq('id', novelId);
  throwIfError(result, 'ingestNovel:updateStatus');

  return { text, chunks, embeddings };
}

module.exports = { parseFile, chunkText, embedChunks, saveToDatabase, ingestNovel, getEmbedder };
