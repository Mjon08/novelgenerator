const { getSupabase, throwIfError } = require('./database/supabaseClient');
const { getEmbedder } = require('./ingest');

async function embedQuery(queryText) {
  const embedder = await getEmbedder();
  const output = await embedder(queryText, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// cosineSimilarity dipertahankan sebagai utilitas — perhitungan similarity
// utama sekarang dilakukan Postgres lewat fungsi match_novel_chunks (pgvector),
// bukan dimuat semua ke memori dan dihitung manual di sini seperti sebelumnya.
function cosineSimilarity(vecA, vecB) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

async function retrieveTopK(queryEmbedding, k = 8) {
  const db = getSupabase();
  const result = await db.rpc('match_novel_chunks', {
    query_embedding: queryEmbedding,
    match_count: k
  });
  const rows = throwIfError(result, 'retrieveTopK');
  return rows.map(row => ({
    id: row.id,
    novel_id: row.novel_id,
    chunk_index: row.chunk_index,
    text: row.text,
    score: row.similarity
  }));
}

async function getStyleProfiles(novelIds) {
  if (!novelIds.length) return [];
  const db = getSupabase();
  // supabase-js merangkai JOIN lewat sintaks embed relasi: nama_tabel(kolom).
  // novels punya foreign key ke style_profiles.novel_id sehingga PostgREST
  // bisa menyisipkan baris novels terkait langsung di setiap hasil.
  const result = await db
    .from('style_profiles')
    .select('*, novels(title, author)')
    .in('novel_id', novelIds);
  const rows = throwIfError(result, 'getStyleProfiles');

  // Ratakan bentuk relasi bersarang agar konsumen lama (contextBuilder dst.)
  // tetap menerima profile.title / profile.author seperti hasil JOIN SQLite dulu.
  return rows.map(({ novels, ...profile }) => ({
    ...profile,
    title: novels?.title,
    author: novels?.author
  }));
}

async function buildRAGContext(userRequest) {
  const db = getSupabase();
  const countResult = await db
    .from('novels')
    .select('id', { count: 'exact', head: true })
    .in('status', ['ready', 'ingested']);
  throwIfError(countResult, 'buildRAGContext:count');
  if (!countResult.count) {
    return { relevantChunks: [], styleProfiles: [], isEmpty: true };
  }

  const queryEmbedding = await embedQuery(userRequest);
  const topChunks = await retrieveTopK(queryEmbedding, 8);

  const novelIdCounts = {};
  for (const c of topChunks) {
    novelIdCounts[c.novel_id] = (novelIdCounts[c.novel_id] || 0) + 1;
  }

  const sortedNovelIds = Object.entries(novelIdCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => parseInt(id));

  const styleProfiles = await getStyleProfiles(sortedNovelIds);

  return { relevantChunks: topChunks, styleProfiles, isEmpty: false };
}

module.exports = { embedQuery, cosineSimilarity, retrieveTopK, getStyleProfiles, buildRAGContext };
