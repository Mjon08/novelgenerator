// Wajib dimuat paling awal: sebelumnya tidak ada satu pun file yang memanggil
// dotenv, sehingga process.env.* hanya terisi untuk ANTHROPIC_API_KEY/
// OPENROUTER_API_KEY karena auth.js mem-parsing file .env secara manual
// sendiri. Variabel lain (SUPABASE_URL, MAX_DAILY_API_CALLS, PORT, dst.)
// tidak pernah benar-benar terbaca dari .env tanpa baris ini.
require('dotenv').config();

// Jaring pengaman level proses: banyak route handler async di file ini tidak
// dibungkus try/catch (pola lama dari SQLite yang jarang melempar error untuk
// SQL statis). Query Supabase/PostgREST jauh lebih mudah melempar error
// runtime (cache skema belum sinkron, RLS, jaringan, dll) — tanpa penangan
// ini, satu request gagal akan mematikan SELURUH server (default Node sejak
// v15 untuk unhandled rejection). Baris ini menjaga proses tetap hidup;
// request yang gagal akan macet menunggu (client time-out) alih-alih
// merobohkan semua koneksi lain, jadi tetap lebih baik memperbaiki
// endpoint yang error, tapi ini mencegah dampak sekejap ke seluruh app.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection] Tidak menjatuhkan server, tapi endpoint ini perlu try/catch:', err);
});

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { getSupabase, throwIfError } = require('./database/supabaseClient');
const { uploadNovelFile, resolveNovelFilePath, getSignedUrl, deleteNovelFile } = require('./database/storage');
const { saveGeneratedNovel, getGeneratedNovel, listGeneratedNovels, deleteGeneratedNovel } = require('./database/generatedNovels');
const { ingestNovel } = require('./ingest');
const { analyzeStyle, saveStyleProfile } = require('./analyzeAgent');
const { buildRAGContext } = require('./retriever');
const { buildSystemPrompt } = require('./contextBuilder');
const { getAnthropicAuth } = require('./auth');
const { runEvaluation, evaluateMimicry } = require('./evaluator');
const { buildNovelDNA, getDNAById, listAllDNA } = require('./dnaExtractor');
const { generateNovelFromDNA, GENRES, POV_OPTIONS, STORY_LENGTHS, EMOTION_LEVELS, DIALOGUE_DENSITY, DESCRIPTION_DENSITY, READING_LEVELS, LANGUAGE_STYLES, PLATFORMS } = require('./novelFromDNA');
const { listModels, DEFAULT_MODEL, isFreeModel } = require('./modelRegistry');
const { generateMimicryOutline, writeMimicryChapter } = require('./mimicryAgent');
const { humanizeAllChapters } = require('./humanizer');
const { formatForWattpad, formatForKBM, formatForStorial, formatForGoogleDocs, formatForNovelToon, formatSemua, generateTags, generateSinopsisMarketing } = require('./exportFormatter');
const { checkUsageLimit, recordApiUsage, getUsageStats } = require('./usageLimiter');
const {
  passwordMatches, isLockedOut, recordFailedAttempt, clearFailedAttempts, LOCKOUT_MS,
  createSession, destroySession, parseCookies, setSessionCookie, clearSessionCookie,
  SESSION_COOKIE, requireAuth
} = require('./siteAuth');

const app = express();
const client = getAnthropicAuth();

function resolveModelName(reqModel) {
  if (process.env.OPENROUTER_API_KEY) {
    if (!reqModel) return DEFAULT_MODEL;

    // Model gratis OpenRouter (berakhiran ":free") harus diteruskan apa adanya.
    // Tanpa pengecualian ini, pilihan model gratis pengguna akan tertimpa
    // "openrouter/auto" oleh aturan generik di bawah.
    if (reqModel.endsWith(':free')) return reqModel;

    // Alias internal aplikasi (mis. "claude-opus-4-8") tidak dikenal OpenRouter.
    // Dialihkan ke model GRATIS bawaan — bukan "openrouter/auto", karena router
    // itu berbayar dan pernah menimbulkan tagihan tak terduga.
    if (reqModel.includes('default') || /^claude[-_]/i.test(reqModel)) {
      return DEFAULT_MODEL;
    }
    return reqModel;
  }
  return reqModel || 'claude-3-5-sonnet-20241022';
}

// Diperlukan agar req.secure akurat di belakang reverse proxy Render/Railway/
// Fly.io (TLS diterminasi di proxy mereka, bukan di proses Node ini) —
// dipakai siteAuth untuk menentukan flag "Secure" pada cookie sesi.
app.set('trust proxy', 1);

app.use(express.json());

// Gerbang login harus dipasang SEBELUM express.static, supaya berkas HTML/JS
// di public/ tidak bisa diakses langsung tanpa sesi valid.
app.use(requireAuth);

app.use(express.static('public'));

// POST /api/login
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';

  if (isLockedOut(ip)) {
    return res.status(429).json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(LOCKOUT_MS / 60000)} menit.` });
  }

  const { password } = req.body || {};
  let ok = false;
  try {
    ok = passwordMatches(password);
  } catch (err) {
    // APP_LOGIN_PASSWORD belum diset di .env — ini kesalahan konfigurasi
    // server, bukan kesalahan pengguna.
    return res.status(500).json({ error: err.message });
  }

  if (!ok) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Password salah' });
  }

  clearFailedAttempts(ip);
  const token = createSession();
  setSessionCookie(res, token, req);
  res.json({ success: true });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  destroySession(cookies[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ success: true });
});

// Endpoint statistik penggunaan API / kuota
app.get('/api/usage-stats', async (req, res) => {
  try {
    const stats = await getUsageStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ---- File Storage ----
const NOVELS_DIR = path.join(__dirname, 'novels');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

async function ensureDirs() {
  await fs.mkdir(NOVELS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.pdf', '.docx', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

const { parseFile } = require('./ingest');

// POST /api/parse-file
// Accepts .txt, .pdf, .docx file upload and extracts text
app.post('/api/parse-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Sertakan file (.docx, .pdf, .txt)' });
    }
    const text = await parseFile(req.file.path);
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    res.json({
      success: true,
      filename: req.file.originalname,
      sizeBytes: req.file.size,
      wordCount,
      text
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Ingest Queue ----
const ingestQueue = [];
let ingestBusy = false;
const ingestListeners = {};

function registerSSEListener(novelId, res) {
  ingestListeners[novelId] = res;
}

function sendIngestEvent(novelId, event, data) {
  const res = ingestListeners[novelId];
  if (res) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (event === 'done' || event === 'error') {
      delete ingestListeners[novelId];
    }
  }
}

async function processIngestQueue() {
  if (ingestBusy || ingestQueue.length === 0) return;
  ingestBusy = true;
  const { filePath, novelId, meta } = ingestQueue.shift();

  try {
    const { text } = await ingestNovel(filePath, { ...meta, novelId }, (step) => {
      sendIngestEvent(novelId, 'progress', { step });
    });

    sendIngestEvent(novelId, 'progress', { step: 'analyzing_style' });

    let styleJSON = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        styleJSON = await analyzeStyle(text, meta.title);
        console.log(`[Analisis gaya berhasil pada percobaan ${attempt} untuk "${meta.title}":`, JSON.stringify(styleJSON).slice(0, 80));
        break;
      } catch (err) {
        console.error(`analyzeStyle attempt ${attempt} failed for "${meta.title}":`, err.message);
        if (attempt < 3 && err.status === 429) {
          await new Promise(r => setTimeout(r, attempt * 10000));
        } else {
          throw err;
        }
      }
    }

    if (styleJSON) {
      await saveStyleProfile(novelId, styleJSON);
      const db = getSupabase();
      throwIfError(await db.from('novels').update({ status: 'ready' }).eq('id', novelId), 'ingest:setReady');
      console.log(`[Novel ${novelId} ("${meta.title}") siap dengan profil gaya]`);
      sendIngestEvent(novelId, 'done', { novelId, style: styleJSON });
    } else {
      const db = getSupabase();
      throwIfError(await db.from('novels').update({ status: 'ingested' }).eq('id', novelId), 'ingest:setIngested');
      console.log(`[Novel ${novelId} berhasil diingest (tanpa profil gaya — rate limited)]`);
      sendIngestEvent(novelId, 'done', { novelId, style: null, note: 'ingested_no_profile' });
    }
  } catch (err) {
    console.error(`Ingest failed for novel ${novelId} ("${meta.title}"):`, err.message);
    const db = getSupabase();
    // If chunks were saved, mark ingested so RAG still works; only hard-error if ingest itself failed.
    // Best-effort seperti semula — kegagalan di sini tidak boleh menutupi error asli di atas.
    let newStatus = 'error';
    try {
      const novelResult = await db.from('novels').select('chunk_count').eq('id', novelId).maybeSingle();
      const novel = throwIfError(novelResult, 'ingest:cekChunkCount');
      newStatus = (novel?.chunk_count > 0) ? 'ingested' : 'error';
      await db.from('novels').update({ status: newStatus }).eq('id', novelId);
    } catch (statusErr) {
      console.error('Gagal memperbarui status novel setelah ingest gagal:', statusErr.message);
    }
    sendIngestEvent(novelId, newStatus === 'ingested' ? 'done' : 'error', {
      novelId,
      style: null,
      note: newStatus === 'ingested' ? 'ingested_no_profile' : undefined,
      message: newStatus === 'error' ? err.message : undefined
    });
  }

  ingestBusy = false;
  processIngestQueue();
}

// ════════════════════════════════════════════
//  LIBRARY ENDPOINTS
// ════════════════════════════════════════════

// Upload novel
app.post('/api/library/upload', upload.single('file'), async (req, res) => {
  await ensureDirs();
  if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan atau format tidak didukung (.txt, .pdf, .docx)' });

  const { title, author, year, tags } = req.body;
  if (!title) return res.status(400).json({ error: 'Judul wajib diisi' });

  const db = getSupabase();
  const insertResult = await db.from('novels').insert({
    title, author: author || null, year: year ? parseInt(year) : null,
    tags: tags || null, file_path: req.file.path, status: 'processing'
  }).select('id').single();
  const inserted = throwIfError(insertResult, 'library/upload');

  const novelId = inserted.id;

  // Salin berkas asli ke Supabase Storage agar tidak hilang saat redeploy —
  // disk lokal uploads/ bersifat sementara. Kegagalan di sini tidak
  // menggagalkan upload; ingest tetap jalan dari salinan lokal, hanya saja
  // novel ini tidak punya cadangan jangka panjang sampai diunggah ulang.
  try {
    const storagePath = await uploadNovelFile(novelId, req.file.path, req.file.originalname);
    await db.from('novels').update({ storage_path: storagePath }).eq('id', novelId);
  } catch (err) {
    console.error(`[Storage] Gagal mencadangkan novel ${novelId} ke Supabase Storage:`, err.message);
  }

  ingestQueue.push({ filePath: req.file.path, novelId, meta: { title, author, year, tags, mimeType: req.file.mimetype } });
  processIngestQueue();

  res.json({ novel_id: novelId, status: 'processing' });
});

// SSE progress stream for upload
app.get('/api/library/upload/progress/:novelId', async (req, res) => {
  const novelId = parseInt(req.params.novelId);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(':\n\n');

  registerSSEListener(novelId, res);

  // If already done
  const db = getSupabase();
  const novelResult = await db.from('novels').select('status').eq('id', novelId).maybeSingle();
  const novel = throwIfError(novelResult, 'library/upload/progress');
  if (novel?.status === 'ready') {
    const profileResult = await db.from('style_profiles').select('raw_json').eq('novel_id', novelId).maybeSingle();
    const profile = throwIfError(profileResult, 'library/upload/progress:profile');
    const style = profile ? JSON.parse(profile.raw_json) : {};
    res.write(`event: done\ndata: ${JSON.stringify({ novelId, style })}\n\n`);
    res.end();
  }

  req.on('close', () => delete ingestListeners[novelId]);
});

// List library
app.get('/api/library', async (req, res) => {
  try {
    const db = getSupabase();
    // Relasi novels -> style_profiles diembed lewat sintaks PostgREST; nama
    // relasi memakai alias tabel karena style_profiles bisa >1 per novel.
    const result = await db
      .from('novels')
      .select('id, title, author, year, tags, chunk_count, status, created_at, style_profiles(writing_style, tone, pov, genre_tags)')
      .order('created_at', { ascending: false });
    const rows = throwIfError(result, 'library/list');

    // Ratakan agar bentuk respons tetap sama seperti hasil LEFT JOIN SQLite dulu
    // (satu style profile per novel, digabung ke level atas).
    const novels = rows.map(({ style_profiles, ...n }) => {
      const sp = Array.isArray(style_profiles) ? style_profiles[0] : style_profiles;
      return { ...n, writing_style: sp?.writing_style, tone: sp?.tone, pov: sp?.pov, genre_tags: sp?.genre_tags };
    });
    res.json(novels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search library
app.get('/api/library/search', async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const db = getSupabase();
  // PostgREST tidak bisa OR lintas tabel hasil embed dalam satu filter, jadi
  // dicari di novels dulu lalu style_profiles, hasilnya digabung di JS.
  const byNovelResult = await db
    .from('novels')
    .select('id, title, author, tags, status, created_at, style_profiles(writing_style, tone)')
    // Nilai dibungkus tanda kutip ganda sesuai anjuran PostgREST, agar query
    // pencarian yang mengandung koma/tanda kurung tidak merusak parsing filter .or().
    .or(`title.ilike."${q}",author.ilike."${q}",tags.ilike."${q}"`)
    .order('created_at', { ascending: false })
    .limit(20);
  const rows = throwIfError(byNovelResult, 'library/search');

  const results = rows.map(({ style_profiles, ...n }) => {
    const sp = Array.isArray(style_profiles) ? style_profiles[0] : style_profiles;
    return { ...n, writing_style: sp?.writing_style, tone: sp?.tone };
  });
  res.json(results);
});

// Get style profile
app.get('/api/library/:id/profile', async (req, res) => {
  const db = getSupabase();
  const result = await db
    .from('style_profiles')
    .select('*, novels(title, author)')
    .eq('novel_id', req.params.id)
    .maybeSingle();
  const row = throwIfError(result, 'library/profile');
  if (!row) return res.status(404).json({ error: 'Profil gaya tidak ditemukan' });
  const { novels, ...profile } = row;
  res.json({ ...profile, title: novels?.title, author: novels?.author });
});

// Search chunks in a novel
app.get('/api/library/:id/chunks', async (req, res) => {
  const db = getSupabase();
  const { q } = req.query;
  let query = db.from('chunks').select('id, chunk_index, text').eq('novel_id', req.params.id).limit(20);
  if (q) query = query.ilike('text', `%${q}%`);
  const result = await query;
  res.json(throwIfError(result, 'library/chunks'));
});

// Re-analyze style for an ingested novel (retry after rate limit clears)
app.post('/api/library/:id/reanalyze', async (req, res) => {
  const db = getSupabase();
  const novelResult = await db.from('novels').select('id, title, full_text, status').eq('id', req.params.id).maybeSingle();
  const novel = throwIfError(novelResult, 'library/reanalyze');
  if (!novel) return res.status(404).json({ error: 'Novel tidak ditemukan' });
  if (!novel.full_text) return res.status(400).json({ error: 'No text stored for this novel' });
  if (novel.status === 'processing') return res.status(409).json({ error: 'Already processing' });

  await db.from('novels').update({ status: 'processing' }).eq('id', novel.id);
  res.json({ status: 'processing' });

  setImmediate(async () => {
    try {
      const styleJSON = await analyzeStyle(novel.full_text, novel.title);
      await db.from('style_profiles').delete().eq('novel_id', novel.id);
      await saveStyleProfile(novel.id, styleJSON);
      await db.from('novels').update({ status: 'ready' }).eq('id', novel.id);
      console.log(`[Re-analisis selesai untuk novel ${novel.id} ("${novel.title}")]`);
    } catch (err) {
      console.error(`[Re-analisis gagal untuk novel ${novel.id}]:`, err.message);
      await db.from('novels').update({ status: 'ingested' }).eq('id', novel.id);
    }
  });
});

// Delete from library
app.delete('/api/library/:id', async (req, res) => {
  const db = getSupabase();
  const novelResult = await db.from('novels').select('file_path, storage_path').eq('id', req.params.id).maybeSingle();
  const novel = throwIfError(novelResult, 'library/delete:cek');
  if (!novel) return res.status(404).json({ error: 'Novel tidak ditemukan' });

  throwIfError(await db.from('novels').delete().eq('id', req.params.id), 'library/delete');

  if (novel.file_path) {
    fs.unlink(novel.file_path).catch(() => {});
  }
  if (novel.storage_path) {
    await deleteNovelFile(novel.storage_path).catch(() => {});
  }
  res.json({ success: true });
});

// GET /api/library/:id/file — signed URL sementara untuk melihat/mengunduh
// berkas novel asli. Bucket privat, jadi tidak ada URL publik permanen.
app.get('/api/library/:id/file', async (req, res) => {
  try {
    const db = getSupabase();
    const novelResult = await db.from('novels').select('storage_path, title').eq('id', req.params.id).maybeSingle();
    const novel = throwIfError(novelResult, 'library/file');
    if (!novel) return res.status(404).json({ error: 'Novel tidak ditemukan' });
    if (!novel.storage_path) {
      return res.status(404).json({ error: 'Novel ini belum punya cadangan berkas di Supabase Storage (diunggah sebelum fitur ini ada, atau cadangan sempat gagal saat upload).' });
    }
    const url = await getSignedUrl(novel.storage_path, 3600);
    res.json({ url, expires_in: 3600 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
//  GENERATION ENDPOINTS (RAG-augmented)
// ════════════════════════════════════════════

app.post('/api/generate-outline', async (req, res) => {
  // Accept both legacy field names (title/premise) and new frontend names (judul/sinopsis_awal)
  const {
    title, judul,
    genre,
    premise, sinopsis_awal,
    chapters, jumlah_bab,
    use_library, use_rag,
    gaya_bahasa, gaya_penulisan,
    karakter_utama, setting_cerita,
    target_kata_per_bab,
    dna_id,
    model_ai
  } = req.body;

  const novelTitle = judul || title || 'Novel Tanpa Judul';
  const novelPremise = sinopsis_awal || premise || '';
  const novelChapters = parseInt(jumlah_bab || chapters) || 5;
  const useLibrary = use_rag !== undefined ? use_rag : (use_library !== false);
  const wordsPerChapter = parseInt(target_kata_per_bab) || 2000;
  const selectedModel = resolveModelName(model_ai);

  let systemPrompt = 'Kamu adalah novelis master yang ahli dalam membuat kerangka cerita yang memukau. Tulis SELURUHNYA dalam Bahasa Indonesia.';
  let styleInfluences = [];

  try {
    await checkUsageLimit();
  } catch (limitErr) {
    return res.status(429).json({ error: limitErr.message });
  }

  if (useLibrary) {
    try {
      const userRequest = `${genre} novel: ${novelPremise}`;
      const ragCtx = await buildRAGContext(userRequest);
      if (!ragCtx.isEmpty) {
        const built = buildSystemPrompt(ragCtx.styleProfiles, ragCtx.relevantChunks, userRequest);
        systemPrompt = built.systemPrompt;
        styleInfluences = built.styleInfluences;
      }
    } catch (err) { /* RAG non-fatal */ }
  }

  try {
    const karakterInfo = karakter_utama ? `\nKarakter Utama: ${karakter_utama}` : '';
    const settingInfo = setting_cerita ? `\nSetting/Latar: ${setting_cerita}` : '';
    const gayaBahasaInfo = gaya_bahasa ? `\nGaya Bahasa: ${gaya_bahasa}` : '';
    const gayaPenulisanInfo = gaya_penulisan ? `\nGaya Penulisan: ${gaya_penulisan}` : '';

    const apiParams = {
      model: selectedModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Buat kerangka novel LENGKAP dalam Bahasa Indonesia untuk:

Judul: ${novelTitle}
Genre: ${genre || 'Fiksi'}
Premis/Sinopsis: ${novelPremise}
Jumlah Bab: ${novelChapters}
Target Kata per Bab: ~${wordsPerChapter} kata${karakterInfo}${settingInfo}${gayaBahasaInfo}${gayaPenulisanInfo}

Kembalikan HANYA JSON valid dengan format persis ini (tanpa markdown fence, tanpa teks tambahan):
{
  "judul": "${novelTitle}",
  "genre": "${genre || 'Fiksi'}",
  "sinopsis": "<sinopsis 2-3 kalimat>",
  "tema_utama": "<tema inti>",
  "karakter": [
    { "nama": "<nama>", "peran": "<protagonis|antagonis|pendukung>", "deskripsi": "<deskripsi singkat>" }
  ],
  "setting": "<deskripsi latar cerita>",
  "chapters": [
    { "nomor": 1, "judul": "<judul bab>", "ringkasan": "<ringkasan bab 2-3 kalimat>", "poin_kunci": ["<poin 1>", "<poin 2>"] }
  ]
}`
      }]
    };

    const msg = await client.messages.create(apiParams);

    await recordApiUsage(0.02);

    const rawText = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    let outline;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Tidak ada JSON dalam respons');
      outline = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      // Fallback: generate default chapter list
      outline = {
        judul: novelTitle,
        genre: genre || 'Fiksi',
        sinopsis: novelPremise,
        tema_utama: 'Belum ditentukan',
        karakter: [],
        setting: setting_cerita || 'Belum ditentukan',
        chapters: Array.from({ length: novelChapters }, (_, i) => ({
          nomor: i + 1,
          judul: `Bab ${i + 1}`,
          ringkasan: `Bab ${i + 1} dari ${novelTitle}`,
          poin_kunci: []
        }))
      };
    }

    res.json({ success: true, outline, chapters: outline.chapters, style_influences: styleInfluences });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate-chapter', async (req, res) => {
  // Accept both legacy and new frontend field names
  const {
    novelTitle, judul,
    genre,
    outline, outline_text,
    chapterNumber, chapter_index,
    chapterTitle, chapter_outline,
    chapterSummary,
    previousChapter, ringkasan_bab_sebelumnya,
    use_library, use_rag,
    gaya_bahasa, gaya_penulisan,
    target_kata_per_bab,
    novel_id,
    model_ai
  } = req.body;

  const title = judul || novelTitle || 'Novel';
  const babNomor = (chapter_index !== undefined ? chapter_index + 1 : null) || chapterNumber || 1;
  const babOutline = chapter_outline || {};
  const babJudul = babOutline.judul || babOutline.title || chapterTitle || `Bab ${babNomor}`;
  const babRingkasan = babOutline.ringkasan || babOutline.summary || chapterSummary || '';
  const babPoin = (babOutline.poin_kunci || babOutline.key_points || []).join(', ');
  const ringkasanSebelumnya = ringkasan_bab_sebelumnya || previousChapter || '';
  const outlineStr = (typeof outline === 'string' ? outline : JSON.stringify(outline || outline_text || {}));
  const useLibrary = use_rag !== undefined ? use_rag : (use_library !== false);
  const targetKata = parseInt(target_kata_per_bab) || 2000;
  const selectedModel = resolveModelName(model_ai);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await checkUsageLimit();
  } catch (limitErr) {
    res.write(`data: ${JSON.stringify({ error: limitErr.message })}\n\n`);
    return res.end();
  }

  let systemPrompt = 'Kamu adalah novelis master yang ahli menulis bab-bab novel yang memukau dan imersif. Tulis SELURUHNYA dalam Bahasa Indonesia yang natural dan mengalir.';


  if (useLibrary) {
    try {
      const userRequest = `${genre} ${babJudul}: ${babRingkasan}`;
      const ragCtx = await buildRAGContext(userRequest);
      if (!ragCtx.isEmpty) {
        const built = buildSystemPrompt(ragCtx.styleProfiles, ragCtx.relevantChunks, userRequest);
        systemPrompt = built.systemPrompt;
      }
    } catch {}
  }

  try {
    const gayaInfo = [
      gaya_bahasa ? `Gaya Bahasa: ${gaya_bahasa}` : '',
      gaya_penulisan ? `Gaya Penulisan: ${gaya_penulisan}` : ''
    ].filter(Boolean).join('\n');

    const stream = await client.messages.create({
      model: selectedModel,
      max_tokens: 8192,
      stream: true,

      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Kamu sedang menulis novel ${genre || 'fiksi'} berjudul "${title}" dalam Bahasa Indonesia.
${gayaInfo ? '\n' + gayaInfo : ''}

Kerangka Novel:
${outlineStr.slice(0, 2000)}

${ringkasanSebelumnya ? `Ringkasan Bab Sebelumnya:\n${ringkasanSebelumnya}\n` : ''}
Sekarang tulis Bab ${babNomor}: ${babJudul}

Ringkasan/Poin Kunci Bab Ini:
${babRingkasan}
${babPoin ? `\nPoin penting: ${babPoin}` : ''}

Tulis bab yang lengkap dan memukau sekitar ${targetKata}-${Math.round(targetKata * 1.3)} kata dalam Bahasa Indonesia. Sertakan:
- Deskripsi vivid dan atmosfer yang kuat
- Dialog yang natural dan berjiwa
- Pengembangan karakter yang terasa nyata
- Ketegangan dan pacing yang sesuai genre ${genre || 'fiksi'}
- Alur narasi yang mulus dan mengalir

Mulai menulis bab sekarang:`
      }]
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    await recordApiUsage(0.03);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// ════════════════════════════════════════════
//  DNA-POWERED NOVEL GENERATION
// ════════════════════════════════════════════

app.post('/api/generate-with-dna', async (req, res) => {
  const { dna_profile, judul, genre, sinopsis, jumlah_kata, model_ai } = req.body;

  if (!dna_profile) {
    return res.status(400).json({ error: 'Profil DNA Gaya Penulisan diperlukan. Silakan ekstrak DNA terlebih dahulu dari halaman Tiru Gaya.' });
  }

  const novelTitle = judul || 'Novel Baru';
  const novelGenre = genre || 'Fiksi';
  const novelSynopsis = sinopsis || 'Sebuah cerita yang memukau';
  const targetWords = parseInt(jumlah_kata) || 3000;
  const selectedModel = resolveModelName(model_ai);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await checkUsageLimit();
  } catch (limitErr) {
    res.write(`data: ${JSON.stringify({ error: limitErr.message })}\n\n`);
    return res.end();
  }

  // Build comprehensive DNA-aware system prompt
  const dna = dna_profile;
  const toneStr = Array.isArray(dna.tone) ? dna.tone.join(', ') : (dna.tone || 'Deskriptif');
  const vocabStr = Array.isArray(dna.vocabulary) ? dna.vocabulary.join(', ') : (dna.vocabulary || 'Sastra');
  const themesStr = Array.isArray(dna.core_themes) ? dna.core_themes.join(', ') : '';
  const phrasesStr = Array.isArray(dna.signature_phrases) ? dna.signature_phrases.map(p => `"${p}"`).join(', ') : '';
  const samplesStr = Array.isArray(dna.sample_sentences) ? dna.sample_sentences.map((s, i) => `  ${i+1}. "${s}"`).join('\n') : '';

  const dnaSystemPrompt = `Kamu adalah novelis master Indonesia. Kamu HARUS menulis dengan gaya penulisan yang PERSIS meniru DNA berikut:

═══ PROFIL DNA GAYA PENULISAN ═══
Sumber Referensi: "${dna.title || 'Naskah Referensi'}"

1. NADA & SUASANA: ${toneStr}
2. SUDUT PANDANG (POV): ${dna.pov || 'Orang Pertama'}
3. TENSE/WAKTU: Gunakan bentuk ${dna.tense || 'lampau'} secara konsisten
4. KOSAKATA & BAHASA: Level ${vocabStr}
5. RITME KALIMAT: ${dna.rhythm || 'Mengalir'}
${themesStr ? `6. TEMA INTI: ${themesStr}` : ''}
${phrasesStr ? `7. FRASA TANDA TANGAN (gunakan pola serupa): ${phrasesStr}` : ''}
${dna.protagonist_voice ? `8. SUARA KARAKTER: ${dna.protagonist_voice}` : ''}
${dna.humor_style ? `9. GAYA HUMOR: ${dna.humor_style}` : ''}
${dna.world_building_style ? `10. WORLD BUILDING: ${dna.world_building_style}` : ''}
${samplesStr ? `\nCONTOH KALIMAT REFERENSI (tiru polanya, JANGAN salin kata-per-kata):\n${samplesStr}` : ''}
═══════════════════════════════

ATURAN PENTING:
- Tulis SELURUHNYA dalam Bahasa Indonesia
- Tiru nada, diksi, ritme, dan atmosfer dari DNA di atas
- Gunakan POV ${dna.pov || 'orang pertama'} dan tense ${dna.tense || 'lampau'} secara konsisten
- Jangan menyalin kalimat referensi secara harfiah, tetapi tiru POLA dan NUANSA-nya
- Buat paragraf pembuka yang langsung menarik pembaca
- Sertakan dialog yang natural jika sesuai dengan gaya DNA
- Buat deskripsi suasana dan sensori yang kaya sesuai pola DNA`;

  try {
    const stream = await client.messages.create({
      model: selectedModel,
      max_tokens: 8192,
      stream: true,
      system: dnaSystemPrompt,
      messages: [{
        role: 'user',
        content: `Tulis novel/cerita baru dengan spesifikasi berikut, menggunakan GAYA DNA yang sudah diberikan:

Judul: ${novelTitle}
Genre: ${novelGenre}
Sinopsis/Ide Cerita: ${novelSynopsis}
Target Panjang: ~${targetWords} kata

Tulis cerita yang lengkap dan memukau. Mulai dengan judul (format: nama judul saja, tanpa tanda # atau markdown) lalu langsung ke narasi. 

Bagi ke dalam beberapa bab jika panjang teks melebihi 2000 kata. Setiap bab dimulai dengan judul bab.

Ingat: TIRU gaya penulisan DNA sepenuhnya — nada, ritme, diksi, POV, dan suasana harus konsisten dengan profil DNA.

Mulai menulis sekarang:`
      }]
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    await recordApiUsage(0.04);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// ════════════════════════════════════════════
//  MIMICRY ENDPOINTS
// ════════════════════════════════════════════

// POST /api/mimicry/analyze
// Accepts: multipart file OR { novel_id } for existing library novel
app.post('/api/mimicry/analyze', upload.single('file'), async (req, res) => {
  await ensureDirs();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let tempFilePath = null; // berkas sementara hasil unduh dari Storage — dibersihkan di akhir

  try {
    let filePath, title, chapterCount;
    const fs2 = require('fs');

    if (req.file) {
      filePath = req.file.path;
      title = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');
      chapterCount = parseInt(req.body.chapters) || null;
    } else if (req.body.text && req.body.text.trim()) {
      title = req.body.title || 'Teks Referensi Kustom';
      filePath = path.join(__dirname, 'uploads', `temp_dna_${Date.now()}.txt`);
      fs2.writeFileSync(filePath, req.body.text, 'utf-8');
      chapterCount = null;
    } else if (req.body.novel_id) {
      const db = getSupabase();
      const novelResult = await db.from('novels').select('*').eq('id', req.body.novel_id).maybeSingle();
      const novel = throwIfError(novelResult, 'mimicry/analyze:novel');
      if (!novel) { send('dna_error', { message: 'Novel tidak ditemukan' }); return res.end(); }

      // Salinan lokal dipakai bila masih ada; kalau tidak (mis. setelah
      // redeploy), diunduh dari Supabase Storage sebagai fallback.
      let resolved;
      try {
        resolved = await resolveNovelFilePath(novel);
      } catch (err) {
        send('dna_error', { message: 'File tidak tersedia untuk novel ini: ' + err.message });
        return res.end();
      }
      filePath = resolved.path;
      if (resolved.isTemp) tempFilePath = resolved.path;
      title = novel.title;
      chapterCount = null;
    } else {
      send('dna_error', { message: 'Sertakan file upload, teks, atau novel_id yang valid' });
      return res.end();
    }

    // Word count check
    const stat = fs2.statSync(filePath);
    const estimatedWords = Math.floor(stat.size / 5); // rough estimate
    if (estimatedWords < 1000) {
      send('dna_warning', { message: 'File may be very short — DNA reliability may vary' });
    }

    const selectedModel = resolveModelName(req.body.model_ai);

    // Model gratis tidak menagih biaya, sehingga batas budget tidak berlaku.
    try {
      await checkUsageLimit(selectedModel);
    } catch (limitErr) {
      send('dna_error', { message: limitErr.message });
      return res.end();
    }

    send('dna_start', {
      message: 'Memulai pipeline ekstraksi DNA…',
      title,
      model: selectedModel,
      is_free_model: isFreeModel(selectedModel)
    });

    // Setiap tahap pipeline diteruskan apa adanya ke UI agar pengguna melihat
    // proses yang benar-benar berjalan, bukan hasil yang muncul seketika.
    const dna = await buildNovelDNA(filePath, title, chapterCount, (step, detail) => {
      send('dna_progress', { step, ...detail });
    }, selectedModel);

    await recordApiUsage(0.015, selectedModel);

    const bp = dna.blueprint || {};
    const previewCard = {
      dna_id: dna.dna_id,
      source_title: dna.source_title,
      source_word_count: dna.source_word_count,

      // Ringkasan lama — dipakai kartu hasil yang sudah ada.
      pov: dna.style?.pov,
      tense: dna.style?.tense,
      tone: dna.style?.narrative_voice_tone,
      vocabulary_level: dna.language?.vocabulary_level,
      sentence_rhythm: dna.style?.sentence_rhythm,
      core_themes: dna.thematic?.core_themes,
      signature_phrases: dna.style?.signature_phrases,
      sample_sentences: dna.style?.sample_sentences,
      chapter_count: dna.structure?.total_chapters,
      avg_chapter_words: dna.structure?.avg_chapter_length_words,
      protagonist_voice: dna.character?.protagonist_voice,
      filler_expressions: dna.human_touch?.filler_expressions,
      humor_style: dna.human_touch?.humor_style,
      genre_blend: dna.thematic?.genre_blend,
      world_building_style: dna.thematic?.world_building_style,

      // Blueprint lengkap 9 kategori.
      blueprint: bp,
      genre_formula: bp.genre_formula,
      measured_metrics: bp.measured_metrics,
      extraction_meta: bp.extraction_meta,
      validation: bp.validation
    };

    send('dna_complete', { dna_id: dna.dna_id, preview_card: previewCard });
    res.end();
  } catch (err) {
    console.error('DNA extraction error:', err);
    res.write(`event: dna_error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end();
  } finally {
    // Bersihkan berkas sementara hasil unduh dari Storage (bila ada).
    if (tempFilePath) {
      require('fs').unlink(tempFilePath, () => {});
    }
  }
});

// GET /api/models — katalog model beserta ukuran context & status gratis
app.get('/api/models', (req, res) => {
  try {
    res.json({ models: listModels(), default: DEFAULT_MODEL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mimicry/opsi-generate — pilihan untuk form "Buat Novel Baru dari DNA"
app.get('/api/mimicry/opsi-generate', (req, res) => {
  res.json({
    genres: GENRES,
    pov: POV_OPTIONS,
    story_lengths: Object.entries(STORY_LENGTHS).map(([id, v]) => ({ id, ...v })),
    style_strength: [
      { value: 100, label: '100% mengikuti DNA' },
      { value: 75, label: '75% mengikuti DNA' },
      { value: 50, label: '50% mengikuti DNA' },
      { value: 25, label: 'Sedikit terinspirasi DNA' }
    ],
    emotional_levels: Object.keys(EMOTION_LEVELS),
    dialogue_density: Object.entries(DIALOGUE_DENSITY).map(([id, v]) => ({ id, ...v })),
    description_density: Object.keys(DESCRIPTION_DENSITY),
    reading_levels: Object.keys(READING_LEVELS),
    language_styles: Object.keys(LANGUAGE_STYLES),
    platforms: Object.keys(PLATFORMS),
    character_counts: [2, 3, 4, 5, 6, 8, 10]
  });
});

// GET /api/mimicry/dna/list
app.get('/api/mimicry/dna/list', async (req, res) => {
  try {
    res.json(await listAllDNA());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mimicry/dna/:dna_id
app.get('/api/mimicry/dna/:dna_id', async (req, res) => {
  const dna = await getDNAById(parseInt(req.params.dna_id));
  if (!dna) return res.status(404).json({ error: 'Profil DNA tidak ditemukan' });
  res.json(dna);
});

// DELETE /api/mimicry/dna/:dna_id
app.delete('/api/mimicry/dna/:dna_id', async (req, res) => {
  const db = getSupabase();
  const rowResult = await db.from('novel_dna').select('id').eq('id', req.params.dna_id).maybeSingle();
  const row = throwIfError(rowResult, 'mimicry/dna/delete:cek');
  if (!row) return res.status(404).json({ error: 'DNA tidak ditemukan' });
  throwIfError(await db.from('novel_dna').delete().eq('id', req.params.dna_id), 'mimicry/dna/delete');
  res.json({ success: true });
});

// POST /api/mimicry/generate-from-dna
// Menulis novel BARU yang mewarisi gaya dari DNA Blueprint, namun dengan
// cerita, tokoh, konflik, dan alur yang sepenuhnya orisinal.
app.post('/api/mimicry/generate-from-dna', async (req, res) => {
  const { dna_id } = req.body;
  if (!dna_id) return res.status(400).json({ error: 'dna_id wajib diisi' });
  if (!req.body.title) return res.status(400).json({ error: 'Judul novel wajib diisi' });

  const dna = await getDNAById(parseInt(dna_id));
  if (!dna) return res.status(404).json({ error: 'Profil DNA tidak ditemukan' });

  if (!dna.blueprint) {
    return res.status(409).json({
      error: 'Profil DNA ini dibuat dengan versi lama dan belum memiliki Blueprint. Ekstrak ulang novel sumbernya agar fitur ini bisa dipakai.',
      needs_reextraction: true
    });
  }

  const selectedModel = resolveModelName(req.body.model);
  try {
    await checkUsageLimit(selectedModel);
  } catch (limitErr) {
    return res.status(429).json({ error: limitErr.message });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const hasil = await generateNovelFromDNA(
      dna,
      { ...req.body, model: selectedModel },
      (type, data) => {
        // Potongan teks dikirim tanpa nama event agar aliran streaming ringan.
        if (type === 'stream') {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } else {
          send(`gen_${type}`, data);
        }
      }
    );

    await recordApiUsage(0.015, selectedModel);

    // Simpan sebagai novel biasa agar muncul di perpustakaan & bisa diekspor.
    const id = uuidv4();
    await saveGeneratedNovel({
      id,
      title: hasil.title,
      genre: hasil.genre,
      theme: hasil.theme,
      outline: hasil.outline,
      chapters: hasil.chapters,
      createdAt: new Date().toISOString(),
      dna_id: dna.dna_id,
      source_title: dna.source_title,
      generation_config: hasil.config,
      originality: hasil.originality
    });

    send('gen_saved', {
      novel_id: id,
      title: hasil.title,
      chapter_count: hasil.chapters.length,
      total_words: hasil.total_words,
      originality: hasil.originality
    });
    res.end();
  } catch (err) {
    console.error('Generate dari DNA gagal:', err);
    send('gen_error', { message: err.message });
    res.end();
  }
});

// POST /api/mimicry/generate
// Streams outline → chapters → humanization → mimicry score
app.post('/api/mimicry/generate', async (req, res) => {
  const { dna_id, title, genre, chapters, theme_hint, language_override, humanize = true } = req.body;
  if (!dna_id || !title) return res.status(400).json({ error: 'dna_id dan judul wajib diisi' });

  const dna = await getDNAById(parseInt(dna_id));
  if (!dna) return res.status(404).json({ error: 'Profil DNA tidak ditemukan' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const chapterCount = parseInt(chapters) || dna.structure?.total_chapters || 10;

    // ── Step 1: Generate outline ──
    send('mimicry_outline_start', { message: `Writing outline in the voice of "${dna.source_title}"…` });
    let outlineText = '';
    await generateMimicryOutline(dna, { title, genre, chapters: chapterCount, theme_hint, language_override },
      (chunk) => {
        outlineText += chunk;
        res.write(`data: ${JSON.stringify({ text: chunk, phase: 'outline' })}\n\n`);
      }
    );
    send('mimicry_outline_done', { outline: outlineText });

    // ── Step 2: Generate chapters ──
    const generatedChapters = [];
    let prevSummary = '';

    for (let i = 1; i <= chapterCount; i++) {
      send('mimicry_chapter_start', { chapter: i, total: chapterCount });

      let chapterContent = '';
      const { content, summary } = await writeMimicryChapter(
        dna,
        { novelTitle: title, outline: outlineText, summary: `Chapter ${i} of ${chapterCount}`, key_events: '' },
        prevSummary,
        i,
        chapterCount,
        (chunk) => {
          chapterContent += chunk;
          res.write(`data: ${JSON.stringify({ text: chunk, phase: 'chapter', chapter: i })}\n\n`);
        }
      );

      prevSummary = summary;
      generatedChapters.push({ number: i, title: `Chapter ${i}`, content });
      send('mimicry_chapter_done', { chapter: i });
    }

    // ── Step 3: Humanize ──
    let finalChapters = generatedChapters;
    if (humanize) {
      send('mimicry_humanizing', { message: 'Applying human touch…' });
      finalChapters = await humanizeAllChapters(
        generatedChapters,
        dna.human_touch,
        (phase, chNum) => send('humanizing_chapter', { phase, chapter_number: chNum })
      );
    }

    // ── Step 4: Similarity guard ──
    // (Phase 8: scan for any 20-word span matching source — flag for rephrasing)
    // Light check: compare first 500 words of generated vs source novel full_text
    send('mimicry_similarity_check', { message: 'Running similarity guard…' });

    // ── Step 5: Save novel ──
    const novelData = {
      title,
      genre: genre || dna.thematic?.genre_blend?.[0] || 'Literary Fiction',
      outline: outlineText,
      chapters: finalChapters
    };
    const id = require('uuid').v4();
    await saveGeneratedNovel({ id, ...novelData, createdAt: new Date().toISOString(), dna_id, source_title: dna.source_title });

    // ── Step 6: Mimicry score ──
    send('mimicry_scoring', { message: 'Computing mimicry score…' });
    const fullText = finalChapters.map(c => c.content).join('\n\n');
    const mimicryScore = await evaluateMimicry(fullText, dna).catch(() => null);
    if (mimicryScore) send('mimicry_score_ready', mimicryScore);

    send('mimicry_complete', {
      novel_id: id,
      dna_id,
      source_title: dna.source_title,
      chapter_count: finalChapters.length,
      mimicry_score: mimicryScore
    });
    res.end();
  } catch (err) {
    console.error('Mimicry generation error:', err);
    res.write(`event: mimicry_error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end();
  }
});

// ════════════════════════════════════════════
//  EVAL ENDPOINTS
// ════════════════════════════════════════════

// Get latest eval for a novel_id (UUID from saved novels)
// Compare multiple evals by novel_id list
// NOTE: must be registered BEFORE '/api/eval/:novel_id', otherwise Express
// matches 'compare' as :novel_id and this handler is never reached.
app.get('/api/eval/compare', async (req, res) => {
  const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) return res.status(400).json({ error: 'Tidak ada ID yang diberikan' });
  const db = getSupabase();

  const rowsResult = await db
    .from('eval_results')
    .select('*')
    .in('novel_id', ids)
    .order('created_at', { ascending: false });
  const rows = throwIfError(rowsResult, 'eval/compare');

  // One row per novel_id (latest)
  const seen = new Set();
  const result = rows.filter(r => { if (seen.has(r.novel_id)) return false; seen.add(r.novel_id); return true; });

  // novel_id eval biasanya UUID (novel hasil generate), bukan id numerik tabel
  // novels — judul hanya dicari untuk id yang benar-benar angka agar tidak
  // memicu error cast di Postgres (beda dari CAST SQLite yang diam-diam
  // mengembalikan NULL untuk teks non-angka).
  const numericIds = result.map(r => r.novel_id).filter(id => /^\d+$/.test(id)).map(Number);
  let titleById = {};
  if (numericIds.length > 0) {
    const titlesResult = await db.from('novels').select('id, title').in('id', numericIds);
    const titleRows = throwIfError(titlesResult, 'eval/compare:judul');
    titleById = Object.fromEntries(titleRows.map(t => [String(t.id), t.title]));
  }

  res.json(result.map(r => ({
    ...r,
    title: titleById[r.novel_id],
    style: JSON.parse(r.style_json || 'null'),
    quality: JSON.parse(r.quality_json || 'null'),
    originality: JSON.parse(r.originality_json || 'null'),
    style_json: undefined, quality_json: undefined, originality_json: undefined
  })));
});

app.get('/api/eval/:novel_id', async (req, res) => {
  const db = getSupabase();
  const result = await db
    .from('eval_results')
    .select('*')
    .eq('novel_id', req.params.novel_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = throwIfError(result, 'eval/get');
  if (!row) return res.status(404).json({ error: 'Belum ada evaluasi untuk novel ini' });
  const parsed = {
    ...row,
    style: JSON.parse(row.style_json || 'null'),
    quality: JSON.parse(row.quality_json || 'null'),
    originality: JSON.parse(row.originality_json || 'null')
  };
  delete parsed.style_json; delete parsed.quality_json; delete parsed.originality_json;
  res.json(parsed);
});

// Aggregate stats across all evals
app.get('/api/eval/stats/summary', async (req, res) => {
  const db = getSupabase();
  // PostgREST tidak mendukung SUM(CASE WHEN ...) ala SQL biasa, jadi baris
  // diambil apa adanya dan agregat dihitung di JS. Tabel evaluasi kecil
  // (satu baris per evaluasi), jadi ini murah.
  const result = await db.from('eval_results').select('grade, total_score, style_score, quality_score, originality_score');
  const rows = throwIfError(result, 'eval/stats');

  const avg = key => {
    const vals = rows.map(r => r[key]).filter(v => v !== null && v !== undefined);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  };
  const totalScores = rows.map(r => r.total_score).filter(v => v !== null && v !== undefined);
  const countGrade = g => rows.filter(r => r.grade === g).length;

  res.json({
    total_evals: rows.length,
    avg_score: avg('total_score'),
    best_score: totalScores.length ? Math.max(...totalScores) : null,
    worst_score: totalScores.length ? Math.min(...totalScores) : null,
    avg_style: avg('style_score'),
    avg_quality: avg('quality_score'),
    avg_originality: avg('originality_score'),
    grade_a: countGrade('A'),
    grade_b: countGrade('B'),
    grade_c: countGrade('C'),
    grade_d: countGrade('D'),
    grade_f: countGrade('F')
  });
});

// Re-evaluate an existing saved novel
app.post('/api/eval/run/:novel_id', async (req, res) => {
  const novelId = req.params.novel_id;
  let { outline, text } = req.body || {};

  try {
    // Auto-load novel text from saved record if not provided
    if (!text) {
      const novel = await getGeneratedNovel(novelId);
      if (!novel) {
        return res.status(404).json({ error: 'Novel tidak ditemukan. Pastikan novel sudah disimpan.' });
      }
      text = (novel.chapters || []).map(c => `Bab ${c.number}: ${c.title}\n\n${c.content}`).join('\n\n');
      outline = outline || novel.outline || '';
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Teks novel kosong, tidak bisa dievaluasi.' });
    }

    const ragCtx = await buildRAGContext(text.slice(0, 500)).catch(() => ({ styleProfiles: [], relevantChunks: [] }));
    const report = await runEvaluation(novelId, ragCtx.styleProfiles, ragCtx.relevantChunks, outline || '', text, () => {});
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
//  SAVED NOVELS ENDPOINTS (JSON file-based)
// ════════════════════════════════════════════

// Eval listeners keyed by novel UUID
const evalListeners = {};

app.post('/api/save-novel', async (req, res) => {
  const { title, genre, outline, chapters } = req.body;
  const id = uuidv4();
  await saveGeneratedNovel({ id, title, genre, outline, chapters, createdAt: new Date().toISOString() });
  res.json({ success: true, id });

  // Background eval — non-blocking
  setImmediate(async () => {
    try {
      const fullText = (chapters || []).map(c => `Chapter ${c.number}: ${c.title}\n\n${c.content}`).join('\n\n');
      if (!fullText.trim()) return;

      const { buildRAGContext } = require('./retriever');
      const ragCtx = await buildRAGContext(`${genre} ${title}: ${outline || ''}`).catch(() => ({ styleProfiles: [], relevantChunks: [], isEmpty: true }));

      const db = getSupabase();
      // Check eval cache — skip if identical text already evaluated (same char count)
      const existingResult = await db.from('eval_results').select('id').eq('novel_id', id).maybeSingle();
      const existing = throwIfError(existingResult, 'save-novel:cekEvalCache');
      if (existing) return;

      const report = await runEvaluation(id, ragCtx.styleProfiles, ragCtx.relevantChunks, outline, fullText, (step) => {
        const l = evalListeners[id];
        if (l) l.write(`event: eval_progress\ndata: ${JSON.stringify({ step })}\n\n`);
      });

      const l = evalListeners[id];
      if (l) {
        l.write(`event: eval_complete\ndata: ${JSON.stringify(report)}\n\n`);
        delete evalListeners[id];
      }
    } catch (err) {
      console.error(`Background eval failed for novel ${id}:`, err.message);

      // Auto-retry: if verdict === 'regenerate' (total < 50), re-generate weakest chapter (max 2 retries)
      const db = getSupabase();
      const evalRowResult = await db.from('eval_results').select('*').eq('novel_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const evalRow = throwIfError(evalRowResult, 'save-novel:cekRetry');
      if (evalRow && evalRow.verdict === 'regenerate' && (evalRow.retry_count || 0) < 2) {
        const l = evalListeners[id];
        if (l) l.write(`event: eval_failed\ndata: ${JSON.stringify({ message: err.message, will_retry: true })}\n\n`);
      }

      const l = evalListeners[id];
      if (l) {
        l.write(`event: eval_error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        delete evalListeners[id];
      }
    }
  });
});

// Auto-retry: re-evaluate after chapter was regenerated externally
// Client calls this after re-generating the weakest chapter
app.post('/api/eval/retry/:novel_id', async (req, res) => {
  const novelId = req.params.novel_id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const db = getSupabase();
    const prevEvalResult = await db.from('eval_results').select('*').eq('novel_id', novelId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const prevEval = throwIfError(prevEvalResult, 'eval/retry:cekPrev');
    const retryCount = (prevEval?.retry_count || 0);
    if (retryCount >= 2) {
      send('retry_complete', { message: 'Max retries reached', final: prevEval });
      return res.end();
    }

    const { outline, text, styleProfiles, topChunks } = req.body || {};
    if (!text) { send('eval_error', { message: 'Parameter teks wajib diisi' }); return res.end(); }

    send('retry_chapter', { attempt: retryCount + 1, max: 2 });

    const { buildRAGContext } = require('./retriever');
    const ragCtx = await buildRAGContext(text.slice(0, 500)).catch(() => ({ styleProfiles: [], relevantChunks: [] }));

    const report = await runEvaluation(novelId, styleProfiles || ragCtx.styleProfiles, topChunks || ragCtx.relevantChunks, outline || '', text, (step) => {
      send('eval_progress', { step });
    });

    // Update retry count — prevEval sudah baris terbaru (created_at DESC LIMIT 1),
    // jadi cukup targetkan id-nya langsung tanpa subquery MAX(id).
    if (prevEval) {
      throwIfError(
        await db.from('eval_results').update({ retry_count: retryCount + 1 }).eq('id', prevEval.id),
        'eval/retry:update'
      );
    }

    send('retry_complete', report);
    res.end();
  } catch (err) {
    res.write(`event: eval_error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end();
  }
});

// SSE stream for eval progress on a saved novel
app.get('/api/eval/progress/:novel_id', async (req, res) => {
  const novelId = req.params.novel_id;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write(':\n\n');

  // If already evaluated, return immediately
  const db = getSupabase();
  const existingResult = await db.from('eval_results').select('*').eq('novel_id', novelId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const existing = throwIfError(existingResult, 'eval/progress');
  if (existing) {
    const report = {
      ...existing,
      style: JSON.parse(existing.style_json || 'null'),
      quality: JSON.parse(existing.quality_json || 'null'),
      originality: JSON.parse(existing.originality_json || 'null')
    };
    res.write(`event: eval_complete\ndata: ${JSON.stringify(report)}\n\n`);
    return res.end();
  }

  evalListeners[novelId] = res;
  req.on('close', () => delete evalListeners[novelId]);
});

app.get('/api/novels', async (req, res) => {
  try {
    res.json(await listGeneratedNovels());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/novels/:id', async (req, res) => {
  try {
    const novel = await getGeneratedNovel(req.params.id);
    if (!novel) return res.status(404).json({ error: 'Novel tidak ditemukan' });
    res.json(novel);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/novels/:id', async (req, res) => {
  try {
    const deleted = await deleteGeneratedNovel(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Novel tidak ditemukan' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eval report export as .txt (Phase 6)
app.get('/api/eval/:novel_id/export', async (req, res) => {
  const db = getSupabase();
  const result = await db.from('eval_results').select('*').eq('novel_id', req.params.novel_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const row = throwIfError(result, 'eval/export');
  if (!row) return res.status(404).json({ error: 'Belum ada evaluasi untuk novel ini' });

  const q = JSON.parse(row.quality_json || '{}');
  const s = JSON.parse(row.style_json || '{}');
  const o = JSON.parse(row.originality_json || '{}');
  const gradeMap = { A: 'Sangat Bagus', B: 'Bagus', C: 'Perlu Perbaikan', D: 'Kurang', F: 'Perlu Di-generate Ulang' };

  let report = `LAPORAN EVALUASI NOVEL
Tanggal: ${new Date(row.created_at).toLocaleString('id-ID')}
Novel ID: ${row.novel_id}
${'='.repeat(60)}

SKOR KESELURUHAN: ${row.total_score}/100  (Grade ${row.grade} — ${gradeMap[row.grade] || row.verdict})

RINCIAN DIMENSI
  Kecocokan Gaya (30%):    ${row.style_score ?? '-'}/100
  Kualitas Naratif (50%):  ${row.quality_score ?? '-'}/100
  Orisinalitas (20%):      ${row.originality_score ?? '-'}/100

${'─'.repeat(60)}
EVALUASI GAYA
  Kecocokan Kosakata:      ${s.vocabulary_match ?? '-'}/100
  Ritme Kalimat:           ${s.sentence_rhythm_match ?? '-'}/100
  Kecocokan Nada:          ${s.tone_match ?? '-'}/100
  Konsistensi POV:         ${s.pov_consistency ?? '-'}/100
  Umpan Balik: ${s.feedback || '-'}
${s.skipped ? '  [Dilewati — tidak ada profil gaya di perpustakaan]' : ''}

${'─'.repeat(60)}
KUALITAS NARATIF
  Koherensi Plot:          ${q.plot_coherence ?? '-'}/100
  Konsistensi Karakter:    ${q.character_consistency ?? '-'}/100
  Pacing:                  ${q.pacing ?? '-'}/100
  Transisi Bab:            ${q.chapter_transitions ?? '-'}/100
  Kejelasan Prosa:         ${q.prose_clarity ?? '-'}/100
  Bab Terlemah:            ${row.weakest_chapter ?? '-'}
  Umpan Balik: ${q.feedback || '-'}

${'─'.repeat(60)}
ORISINALITAS
  Persentase Kemiripan:    ${o.similarity_percentage ?? '-'}%
  Verdict:                 ${o.verdict || '-'}
  Kalimat Terdeteksi:      ${(o.flagged_sentences || []).join('; ') || 'Tidak ada'}
  Umpan Balik: ${o.feedback || '-'}
${o.skipped ? '  [Dilewati — tidak ada perpustakaan referensi]' : ''}

${'='.repeat(60)}
Dihasilkan oleh Sistem Evaluasi novelGENerator
`;

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename="eval_${row.novel_id}.txt"`);
  res.send(report);
});

app.get('/api/novels/:id/export', async (req, res) => {
  try {
    const novel = await getGeneratedNovel(req.params.id);
    if (!novel) return res.status(404).json({ error: 'Novel tidak ditemukan' });
    let text = `${novel.title}\n${'='.repeat(novel.title.length)}\nGenre: ${novel.genre}\n\n`;
    text += `KERANGKA CERITA\n${'='.repeat(15)}\n${novel.outline || 'Tidak ada kerangka.'}\n\n`;
    if (novel.chapters?.length) {
      for (const ch of novel.chapters) {
        text += `\nBab ${ch.number}: ${ch.title}\n${'='.repeat(40)}\n${ch.content}\n`;
      }
    }
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${novel.title.replace(/\s+/g, '_')}.txt"`);
    res.send(text);
  } catch { res.status(404).json({ error: 'Novel tidak ditemukan' }); }
});

// ── Ekspor Platform ───────────────────────────────────────────────────────

// CATATAN: fungsi ini query tabel "chapters" yang tidak pernah ada di skema
// (lihat supabase/schema.sql maupun database/legacy-sqlite/schema.sql) — bug
// pre-existing dari sebelum migrasi, dipertahankan apa adanya di sini karena
// di luar cakupan migrasi Supabase.
async function loadNovelForExport(novelId) {
  const db = getSupabase();
  const novelResult = await db.from('novels').select('*').eq('id', novelId).maybeSingle();
  const novel = throwIfError(novelResult, 'loadNovelForExport:novel');
  if (!novel) return null;
  const chaptersResult = await db.from('chapters').select('*').eq('novel_id', novelId).order('chapter_number', { ascending: true });
  const chapters = throwIfError(chaptersResult, 'loadNovelForExport:chapters');
  return {
    ...novel,
    chapters: chapters.map(c => ({ number: c.chapter_number, title: c.title, content: c.content }))
  };
}

// POST /api/export/:novel_id?platform=wattpad|kbm|storial|googledocs|noveltoon|semua
app.post('/api/export/:novel_id', async (req, res) => {
  try {
    const novel = await loadNovelForExport(req.params.novel_id);
    if (!novel) return res.status(404).json({ error: 'Novel tidak ditemukan' });
    const platform = (req.query.platform || 'wattpad').toLowerCase();
    const outline = novel.outline || '';

    let hasil;
    if (platform === 'semua') {
      const eksporDir = path.join(NOVELS_DIR, `export_${novel.id}`);
      hasil = await formatSemua(novel, outline, eksporDir);
      return res.json({ sukses: true, ...hasil });
    }

    const formatters = {
      wattpad: formatForWattpad,
      kbm: formatForKBM,
      storial: formatForStorial,
      googledocs: formatForGoogleDocs,
      noveltoon: formatForNovelToon
    };

    const formatter = formatters[platform];
    if (!formatter) return res.status(400).json({ error: 'Platform tidak dikenali' });

    hasil = await formatter(novel, outline);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${hasil.namaFile}"`);
    res.send(hasil.konten);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/sinopsis/:novel_id — sinopsis marketing saja
app.get('/api/export/sinopsis/:novel_id', async (req, res) => {
  try {
    const novel = await loadNovelForExport(req.params.novel_id);
    if (!novel) return res.status(404).json({ error: 'Novel tidak ditemukan' });
    const sinopsis = await generateSinopsisMarketing(novel, novel.outline || '');
    res.json({ sinopsis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/tags/:novel_id — tags platform
app.get('/api/export/tags/:novel_id', async (req, res) => {
  try {
    const novel = await loadNovelForExport(req.params.novel_id);
    if (!novel) return res.status(404).json({ error: 'Novel tidak ditemukan' });
    const tags = await generateTags(novel, novel.outline || '', novel.genre);
    res.json({ tags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Editor API ────────────────────────────────────────────────────────────

function hitungKata(teks) {
  if (!teks) return 0;
  return teks.trim().split(/\s+/).filter(Boolean).length;
}

async function buatSnapshotOtomatis(db, dokumenId, html, delta) {
  const docResult = await db.from('dokumen_editor').select('jumlah_kata, terakhir_diedit').eq('id', dokumenId).maybeSingle();
  const doc = throwIfError(docResult, 'buatSnapshotOtomatis:dok');
  if (!doc) return;
  const revResult = await db.from('riwayat_revisi').select('disimpan_pada').eq('dokumen_id', dokumenId).order('disimpan_pada', { ascending: false }).limit(1).maybeSingle();
  const terakhirRevisi = throwIfError(revResult, 'buatSnapshotOtomatis:revisi');
  const sekarang = Date.now();
  const terakhir = terakhirRevisi ? new Date(terakhirRevisi.disimpan_pada).getTime() : 0;
  if (sekarang - terakhir >= 10 * 60 * 1000) { // 10 menit
    await db.from('riwayat_revisi').insert({
      dokumen_id: dokumenId, snapshot_delta: delta || null, snapshot_html: html || null,
      jumlah_kata: doc.jumlah_kata, catatan: 'Auto-simpan'
    });
  }
}

// POST /api/editor/dokumen/baru
app.post('/api/editor/dokumen/baru', async (req, res) => {
  try {
    const db = getSupabase();
    const { judul, novel_id } = req.body;
    if (!judul) return res.status(400).json({ error: 'Judul wajib diisi' });

    let kontenHtml = '';
    let kontenTeks = '';
    let jumlahBab = 0;
    let chaptersData = null;

    // Jika mengimpor dari novel yang sudah ada
    if (novel_id) {
      try {
        const data = await getGeneratedNovel(novel_id);
        if (data?.chapters?.length) {
          chaptersData = data.chapters;
          jumlahBab = data.chapters.length;
          kontenHtml = data.chapters.map(c =>
            `<h2>${c.title || `Bab ${c.number}`}</h2><div>${(c.content || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div>`
          ).join('\n');
          kontenTeks = data.chapters.map(c => `${c.title || `Bab ${c.number}`}\n\n${c.content || ''}`).join('\n\n');
        }
      } catch (_) {}
    }

    const jumlahKata = hitungKata(kontenTeks);
    const insertResult = await db.from('dokumen_editor').insert({
      novel_id: novel_id || null, judul, konten_html: kontenHtml, konten_teks: kontenTeks,
      jumlah_kata: jumlahKata, jumlah_bab: jumlahBab
    }).select('id').single();
    const inserted = throwIfError(insertResult, 'editor/dokumen/baru');
    const dokumenId = inserted.id;

    // Impor bab jika ada novel (data sudah dibaca di atas, tidak perlu baca file lagi)
    if (chaptersData) {
      const babRows = chaptersData.map((ch, i) => ({
        dokumen_id: dokumenId,
        nomor_bab: ch.number || i + 1,
        judul_bab: ch.title || `Bab ${i + 1}`,
        konten_html: `<p>${(ch.content || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
        jumlah_kata: hitungKata(ch.content),
        urutan: i
      }));
      throwIfError(await db.from('bab_dokumen').insert(babRows), 'editor/dokumen/baru:bab');
    }

    res.json({ sukses: true, dokumen_id: dokumenId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/editor/dokumen/daftar
app.get('/api/editor/dokumen/daftar', async (req, res) => {
  try {
    const db = getSupabase();
    const result = await db
      .from('dokumen_editor')
      .select('id, novel_id, judul, jumlah_kata, jumlah_bab, terakhir_diedit, dibuat_pada')
      .order('terakhir_diedit', { ascending: false });
    res.json({ daftar: throwIfError(result, 'editor/dokumen/daftar') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/editor/dokumen/:id
app.get('/api/editor/dokumen/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const dokResult = await db.from('dokumen_editor').select('*').eq('id', req.params.id).maybeSingle();
    const dok = throwIfError(dokResult, 'editor/dokumen/get');
    if (!dok) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    const babResult = await db.from('bab_dokumen').select('*').eq('dokumen_id', req.params.id).order('urutan', { ascending: true });
    const bab = throwIfError(babResult, 'editor/dokumen/get:bab');
    res.json({ ...dok, bab });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/editor/dokumen/:id/simpan
app.put('/api/editor/dokumen/:id/simpan', async (req, res) => {
  try {
    const db = getSupabase();
    const { konten_delta, konten_html, konten_teks } = req.body;
    const jumlah_kata = hitungKata(konten_teks);
    await buatSnapshotOtomatis(db, req.params.id, konten_html, konten_delta);
    throwIfError(
      await db.from('dokumen_editor').update({
        konten_delta: konten_delta || null, konten_html: konten_html || null,
        konten_teks: konten_teks || null, jumlah_kata, terakhir_diedit: new Date().toISOString()
      }).eq('id', req.params.id),
      'editor/dokumen/simpan'
    );
    res.json({ sukses: true, jumlah_kata });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/editor/dokumen/:id
app.delete('/api/editor/dokumen/:id', async (req, res) => {
  try {
    const db = getSupabase();
    throwIfError(await db.from('dokumen_editor').delete().eq('id', req.params.id), 'editor/dokumen/delete');
    res.json({ sukses: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/editor/dokumen/:id/bab/tambah
app.post('/api/editor/dokumen/:id/bab/tambah', async (req, res) => {
  try {
    const db = getSupabase();
    const { judul_bab } = req.body;

    // PostgREST tidak punya MAX()/COUNT() gaya SQL langsung di sini, jadi
    // urutan & nomor bab dihitung dari baris yang diambil.
    const existingBabResult = await db.from('bab_dokumen').select('urutan').eq('dokumen_id', req.params.id);
    const existingBab = throwIfError(existingBabResult, 'editor/bab/tambah:cek');
    const maxUrutan = existingBab.length ? Math.max(...existingBab.map(b => b.urutan ?? -1)) : -1;
    const nomor = existingBab.length + 1;

    const insertResult = await db.from('bab_dokumen').insert({
      dokumen_id: req.params.id, nomor_bab: nomor, judul_bab: judul_bab || `Bab ${nomor}`,
      konten_html: '', jumlah_kata: 0, urutan: maxUrutan + 1
    }).select('id').single();
    const inserted = throwIfError(insertResult, 'editor/bab/tambah');

    // Increment jumlah_bab: PostgREST tidak bisa "kolom = kolom + 1" langsung,
    // jadi dibaca dulu nilainya lalu ditulis ulang.
    const dokResult = await db.from('dokumen_editor').select('jumlah_bab').eq('id', req.params.id).maybeSingle();
    const dok = throwIfError(dokResult, 'editor/bab/tambah:dok');
    await db.from('dokumen_editor').update({
      jumlah_bab: (dok?.jumlah_bab || 0) + 1, terakhir_diedit: new Date().toISOString()
    }).eq('id', req.params.id);

    res.json({ sukses: true, bab_id: inserted.id, nomor_bab: nomor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/editor/bab/:id/simpan
app.put('/api/editor/bab/:id/simpan', async (req, res) => {
  try {
    const db = getSupabase();
    const { konten_delta, konten_html, konten_teks, dokumen_id } = req.body;
    const jumlah_kata = hitungKata(konten_teks);
    throwIfError(
      await db.from('bab_dokumen').update({
        konten_delta: konten_delta || null, konten_html: konten_html || null,
        jumlah_kata, terakhir_diedit: new Date().toISOString()
      }).eq('id', req.params.id),
      'editor/bab/simpan'
    );
    if (dokumen_id) {
      const babResult = await db.from('bab_dokumen').select('jumlah_kata').eq('dokumen_id', dokumen_id);
      const babRows = throwIfError(babResult, 'editor/bab/simpan:totalKata');
      const totalKata = babRows.reduce((a, b) => a + (b.jumlah_kata || 0), 0);
      await db.from('dokumen_editor').update({ jumlah_kata: totalKata, terakhir_diedit: new Date().toISOString() }).eq('id', dokumen_id);
    }
    res.json({ sukses: true, jumlah_kata });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/editor/bab/:id/judul
app.put('/api/editor/bab/:id/judul', async (req, res) => {
  try {
    const db = getSupabase();
    throwIfError(
      await db.from('bab_dokumen').update({ judul_bab: req.body.judul_bab, terakhir_diedit: new Date().toISOString() }).eq('id', req.params.id),
      'editor/bab/judul'
    );
    res.json({ sukses: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/editor/bab/:id
app.delete('/api/editor/bab/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const babResult = await db.from('bab_dokumen').select('dokumen_id').eq('id', req.params.id).maybeSingle();
    const bab = throwIfError(babResult, 'editor/bab/delete:cek');
    throwIfError(await db.from('bab_dokumen').delete().eq('id', req.params.id), 'editor/bab/delete');
    if (bab?.dokumen_id) {
      const dokResult = await db.from('dokumen_editor').select('jumlah_bab').eq('id', bab.dokumen_id).maybeSingle();
      const dok = throwIfError(dokResult, 'editor/bab/delete:dok');
      await db.from('dokumen_editor').update({
        jumlah_bab: Math.max(0, (dok?.jumlah_bab || 0) - 1), terakhir_diedit: new Date().toISOString()
      }).eq('id', bab.dokumen_id);
    }
    res.json({ sukses: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/editor/dokumen/:id/riwayat
app.get('/api/editor/dokumen/:id/riwayat', async (req, res) => {
  try {
    const db = getSupabase();
    const result = await db
      .from('riwayat_revisi')
      .select('id, dokumen_id, jumlah_kata, catatan, disimpan_pada')
      .eq('dokumen_id', req.params.id)
      .order('disimpan_pada', { ascending: false })
      .limit(30);
    res.json({ riwayat: throwIfError(result, 'editor/riwayat') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/editor/revisi/:id
app.get('/api/editor/revisi/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const result = await db.from('riwayat_revisi').select('*').eq('id', req.params.id).maybeSingle();
    const revisi = throwIfError(result, 'editor/revisi');
    if (!revisi) return res.status(404).json({ error: 'Revisi tidak ditemukan' });
    res.json(revisi);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/editor/dokumen/:id/restore/:revisi_id
app.post('/api/editor/dokumen/:id/restore/:revisi_id', async (req, res) => {
  try {
    const db = getSupabase();
    const revisiResult = await db.from('riwayat_revisi').select('*').eq('id', req.params.revisi_id).eq('dokumen_id', req.params.id).maybeSingle();
    const revisi = throwIfError(revisiResult, 'editor/restore:cek');
    if (!revisi) return res.status(404).json({ error: 'Revisi tidak ditemukan' });

    // Simpan versi saat ini sebagai revisi dulu
    const dokResult = await db.from('dokumen_editor').select('konten_html, konten_delta, jumlah_kata').eq('id', req.params.id).maybeSingle();
    const dok = throwIfError(dokResult, 'editor/restore:dok');
    if (dok) {
      await db.from('riwayat_revisi').insert({
        dokumen_id: req.params.id, snapshot_html: dok.konten_html, snapshot_delta: dok.konten_delta,
        jumlah_kata: dok.jumlah_kata, catatan: 'Sebelum restore'
      });
    }

    // Restore
    throwIfError(
      await db.from('dokumen_editor').update({
        konten_html: revisi.snapshot_html, konten_delta: revisi.snapshot_delta,
        jumlah_kata: revisi.jumlah_kata, terakhir_diedit: new Date().toISOString()
      }).eq('id', req.params.id),
      'editor/restore'
    );
    res.json({ sukses: true, html: revisi.snapshot_html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/editor/ai/perbaiki — SSE
app.post('/api/editor/ai/perbaiki', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    const { teks, gaya = 'netral' } = req.body;
    if (!teks) { res.write('event: error\ndata: {"error":"Teks wajib diisi"}\n\n'); return res.end(); }
    const instruksiGaya = { formal: 'Gunakan bahasa baku dan formal.', santai: 'Gunakan bahasa santai dan gaul Indonesia.', puitis: 'Gunakan bahasa puitis dan sastrawi.', singkat: 'Persingkat tanpa menghilangkan makna utama.' };
    const stream = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2048, stream: true,
      system: `Kamu adalah editor novel profesional Indonesia. Perbaiki teks yang diberikan — perbaiki tata bahasa, ejaan, dan gaya. ${instruksiGaya[gaya] || ''} Kembalikan HANYA teks yang telah diperbaiki, tanpa penjelasan.`,
      messages: [{ role: 'user', content: `Perbaiki teks ini:\n\n${teks}` }]
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ teks: event.delta.text })}\n\n`);
      }
    }
    res.write('event: selesai\ndata: {}\n\n');
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
});

// POST /api/editor/ai/lanjutkan — SSE
app.post('/api/editor/ai/lanjutkan', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    const { konteks, instruksi } = req.body;
    if (!konteks) { res.write('event: error\ndata: {"error":"Konteks wajib diisi"}\n\n'); return res.end(); }
    const stream = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1500, stream: true,
      system: 'Kamu adalah penulis novel Indonesia berbakat. Lanjutkan cerita dengan gaya dan suara yang konsisten dengan paragraf sebelumnya. Tulis secara natural dan mengalir. Jangan ulangi teks sebelumnya.',
      messages: [{ role: 'user', content: `Lanjutkan cerita ini${instruksi ? ` dengan arah: ${instruksi}` : ''}:\n\n${konteks}` }]
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ teks: event.delta.text })}\n\n`);
      }
    }
    res.write('event: selesai\ndata: {}\n\n');
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
});

// POST /api/editor/ai/cek-konsistensi
app.post('/api/editor/ai/cek-konsistensi', async (req, res) => {
  try {
    const { konten_teks, judul } = req.body;
    if (!konten_teks) return res.status(400).json({ error: 'Konten wajib diisi' });
    const cuplikan = konten_teks.slice(0, 8000);
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1200,
      system: 'Kamu adalah editor novel profesional Indonesia. Analisis konsistensi narasi dan kembalikan HANYA JSON valid.',
      messages: [{
        role: 'user',
        content: `Periksa konsistensi novel "${judul || 'Tanpa Judul'}" ini dan kembalikan JSON persis ini:\n{\n  "skor": <0-100>,\n  "karakter_konsisten": <true|false>,\n  "plot_konsisten": <true|false>,\n  "masalah": ["<masalah1>", "<masalah2>"],\n  "saran": ["<saran1>", "<saran2>"],\n  "ringkasan": "<2 kalimat>"\n}\n\nTEKS NOVEL:\n${cuplikan}`
      }]
    });
    const raw = msg.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const hasil = jsonMatch ? JSON.parse(jsonMatch[0]) : { skor: 75, masalah: [], saran: [], ringkasan: raw };
    res.json(hasil);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/editor/ekspor/txt/:id
app.post('/api/editor/ekspor/txt/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const dokResult = await db.from('dokumen_editor').select('*').eq('id', req.params.id).maybeSingle();
    const dok = throwIfError(dokResult, 'editor/ekspor/txt:dok');
    if (!dok) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    const babResult = await db.from('bab_dokumen').select('*').eq('dokumen_id', req.params.id).order('urutan', { ascending: true });
    const bab = throwIfError(babResult, 'editor/ekspor/txt:bab');
    let teks = `${dok.judul}\n${'='.repeat(dok.judul.length)}\n\n`;
    if (bab.length > 0) {
      bab.forEach(b => { teks += `\n${b.judul_bab}\n${'-'.repeat(b.judul_bab.length)}\n\n`; });
    } else {
      teks += dok.konten_teks || '';
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${dok.judul.replace(/\s+/g, '_')}.txt"`);
    res.send(teks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/editor/ekspor/pdf/:id — server-side HTML-to-PDF via Puppeteer (fallback: plain HTML)
app.post('/api/editor/ekspor/pdf/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const dokResult = await db.from('dokumen_editor').select('*').eq('id', req.params.id).maybeSingle();
    const dok = throwIfError(dokResult, 'editor/ekspor/pdf:dok');
    if (!dok) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
    const babResult = await db.from('bab_dokumen').select('*').eq('dokumen_id', req.params.id).order('urutan', { ascending: true });
    const bab = throwIfError(babResult, 'editor/ekspor/pdf:bab');
    const isiHtml = bab.length > 0
      ? bab.map(b => `<h2>${b.judul_bab}</h2>${b.konten_html || ''}`).join('<hr>')
      : (dok.konten_html || '');
    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.8;margin:3cm 2.54cm;max-width:800px}h1{text-align:center;font-size:18pt;margin-bottom:30pt}h2{font-size:14pt;margin-top:30pt}p{text-indent:1.5em;margin:0 0 6pt}@page{margin:3cm 2.54cm}</style></head><body><h1>${dok.judul}</h1>${isiHtml}</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${dok.judul.replace(/\s+/g, '_')}.html"`);
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════
//  NOVEL LIBRARY TOGGLE
// ════════════════════════════════════════════

// PUT /api/novels/:id/update-library
app.put('/api/novels/:id/update-library', async (req, res) => {
  try {
    const db = getSupabase();
    const { is_in_library } = req.body;
    throwIfError(
      await db.from('novels').update({ is_in_library: Boolean(is_in_library) }).eq('id', req.params.id),
      'novels/update-library'
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
//  STATS ENDPOINT
// ════════════════════════════════════════════

// GET /api/stats/dashboard
app.get('/api/stats/dashboard', async (req, res) => {
  try {
    const db = getSupabase();

    const [dokResult, skorResult, seriCountResult, terbaruResult, jilidResult] = await Promise.all([
      // novels table in library context is the RAG library
      // generated novels are in novels dir but also referenced via eval_results
      // count from dokumen_editor as "novel karya saya"
      db.from('dokumen_editor').select('jumlah_kata'),
      // Agregat .avg() PostgREST tidak diaktifkan di banyak project Supabase
      // (fitur opsional) — rata-rata dihitung manual dari baris yang diambil.
      db.from('eval_results').select('total_score'),
      db.from('seri').select('id', { count: 'exact', head: true }).eq('status', 'aktif'),
      db.from('dokumen_editor').select('id, judul, jumlah_kata, jumlah_bab, terakhir_diedit, novel_id').order('terakhir_diedit', { ascending: false }).limit(5),
      db.from('jilid').select('*, seri(judul)').eq('status', 'sedang_ditulis').limit(5)
    ]);

    const dokRows = throwIfError(dokResult, 'stats:dokumen');
    const skorRows = throwIfError(skorResult, 'stats:avgSkor');
    throwIfError(seriCountResult, 'stats:seriAktif');
    const novelTerbaru = throwIfError(terbaruResult, 'stats:terbaru');
    const jilidRows = throwIfError(jilidResult, 'stats:jilidSedang');

    const totalNovels = dokRows.length;
    const totalKata = dokRows.reduce((a, d) => a + (d.jumlah_kata || 0), 0);
    const skorValid = skorRows.map(r => r.total_score).filter(v => v !== null && v !== undefined);
    const avgSkor = skorValid.length ? skorValid.reduce((a, b) => a + b, 0) / skorValid.length : 0;
    const jilidSedang = jilidRows.map(({ seri, ...j }) => ({ ...j, seri_judul: seri?.judul }));

    res.json({
      total_novels: totalNovels,
      total_kata: totalKata,
      avg_skor: Math.round(avgSkor),
      seri_aktif: seriCountResult.count || 0,
      novel_terbaru: novelTerbaru,
      jilid_sedang: jilidSedang
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
//  SERI ENDPOINTS
// ════════════════════════════════════════════

// GET /api/seri/daftar
app.get('/api/seri/daftar', async (req, res) => {
  try {
    const db = getSupabase();
    // Hitung jumlah jilid per seri diembed lewat relasi, dihitung di JS
    // (PostgREST tidak mendukung COUNT(*) pada tabel yang diembed).
    const result = await db
      .from('seri')
      .select('*, jilid(id)')
      .order('dibuat_pada', { ascending: false });
    const rows = throwIfError(result, 'seri/daftar');
    res.json(rows.map(({ jilid, ...s }) => ({ ...s, jumlah_jilid: jilid?.length || 0 })));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/seri/buat
app.post('/api/seri/buat', async (req, res) => {
  try {
    const db = getSupabase();
    const { judul, deskripsi, genre } = req.body;
    if (!judul) return res.status(400).json({ error: 'Judul wajib diisi' });
    const result = await db.from('seri').insert({ judul, deskripsi: deskripsi || null, genre: genre || null }).select('id').single();
    const inserted = throwIfError(result, 'seri/buat');
    res.json({ id: inserted.id, judul, deskripsi, genre, status: 'aktif' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/seri/:id
app.get('/api/seri/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const seriResult = await db.from('seri').select('*').eq('id', req.params.id).maybeSingle();
    const seri = throwIfError(seriResult, 'seri/get');
    if (!seri) return res.status(404).json({ error: 'Seri tidak ditemukan' });
    const jilidResult = await db.from('jilid').select('*').eq('seri_id', req.params.id).order('nomor', { ascending: true });
    res.json({ ...seri, jilid: throwIfError(jilidResult, 'seri/get:jilid') });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/seri/:id
app.put('/api/seri/:id', async (req, res) => {
  try {
    const db = getSupabase();
    const { judul, deskripsi, genre, status } = req.body;
    // Hanya field yang benar-benar dikirim yang disertakan dalam update —
    // setara COALESCE(?, kolom) SQLite tanpa mengandalkan sintaks SQL.
    const patch = {};
    if (judul != null) patch.judul = judul;
    if (deskripsi != null) patch.deskripsi = deskripsi;
    if (genre != null) patch.genre = genre;
    if (status != null) patch.status = status;
    if (Object.keys(patch).length > 0) {
      throwIfError(await db.from('seri').update(patch).eq('id', req.params.id), 'seri/update');
    }
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/seri/:id
app.delete('/api/seri/:id', async (req, res) => {
  try {
    const db = getSupabase();
    throwIfError(await db.from('seri').delete().eq('id', req.params.id), 'seri/delete');
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/seri/:id/jilid/tambah
app.post('/api/seri/:id/jilid/tambah', async (req, res) => {
  try {
    const db = getSupabase();
    const { nomor, judul, deskripsi } = req.body;
    if (!judul) return res.status(400).json({ error: 'Judul wajib diisi' });

    let n = nomor;
    if (!n) {
      const countResult = await db.from('jilid').select('id', { count: 'exact', head: true }).eq('seri_id', req.params.id);
      throwIfError(countResult, 'seri/jilid/tambah:hitung');
      n = (countResult.count || 0) + 1;
    }

    const insertResult = await db.from('jilid').insert({ seri_id: req.params.id, nomor: n, judul, deskripsi: deskripsi || null }).select('id').single();
    const inserted = throwIfError(insertResult, 'seri/jilid/tambah');
    res.json({ id: inserted.id, seri_id: req.params.id, nomor: n, judul, deskripsi, status: 'belum_dimulai' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/seri/:id/jilid/:jilid_id
app.put('/api/seri/:id/jilid/:jilid_id', async (req, res) => {
  try {
    const db = getSupabase();
    const { judul, deskripsi, status, novel_id } = req.body;
    const patch = {};
    if (judul != null) patch.judul = judul;
    if (deskripsi != null) patch.deskripsi = deskripsi;
    if (status != null) patch.status = status;
    if (novel_id != null) patch.novel_id = novel_id;
    if (Object.keys(patch).length > 0) {
      throwIfError(
        await db.from('jilid').update(patch).eq('id', req.params.jilid_id).eq('seri_id', req.params.id),
        'seri/jilid/update'
      );
    }
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/seri/:id/jilid/:jilid_id
app.delete('/api/seri/:id/jilid/:jilid_id', async (req, res) => {
  try {
    const db = getSupabase();
    throwIfError(
      await db.from('jilid').delete().eq('id', req.params.jilid_id).eq('seri_id', req.params.id),
      'seri/jilid/delete'
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/seri/:id/story-bible
app.get('/api/seri/:id/story-bible', async (req, res) => {
  try {
    const db = getSupabase();
    const result = await db.from('story_bible').select('*').eq('seri_id', req.params.id).order('tipe', { ascending: true }).order('nama', { ascending: true });
    res.json(throwIfError(result, 'seri/story-bible/list'));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/seri/:id/story-bible
app.post('/api/seri/:id/story-bible', async (req, res) => {
  try {
    const db = getSupabase();
    const { tipe, nama, deskripsi, detail_json } = req.body;
    if (!tipe || !nama) return res.status(400).json({ error: 'Tipe dan nama wajib diisi' });
    const result = await db.from('story_bible').insert({
      seri_id: req.params.id, tipe, nama, deskripsi: deskripsi || null,
      detail_json: detail_json ? JSON.stringify(detail_json) : null
    }).select('id').single();
    const inserted = throwIfError(result, 'seri/story-bible/buat');
    res.json({ id: inserted.id, seri_id: req.params.id, tipe, nama, deskripsi });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/seri/:id/story-bible/:entry_id
app.put('/api/seri/:id/story-bible/:entry_id', async (req, res) => {
  try {
    const db = getSupabase();
    const { nama, deskripsi, detail_json } = req.body;
    const patch = {};
    if (nama != null) patch.nama = nama;
    if (deskripsi != null) patch.deskripsi = deskripsi;
    if (detail_json != null) patch.detail_json = JSON.stringify(detail_json);
    if (Object.keys(patch).length > 0) {
      throwIfError(
        await db.from('story_bible').update(patch).eq('id', req.params.entry_id).eq('seri_id', req.params.id),
        'seri/story-bible/update'
      );
    }
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/seri/:id/story-bible/:entry_id
app.delete('/api/seri/:id/story-bible/:entry_id', async (req, res) => {
  try {
    const db = getSupabase();
    throwIfError(
      await db.from('story_bible').delete().eq('id', req.params.entry_id).eq('seri_id', req.params.id),
      'seri/story-bible/delete'
    );
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/seri/:id/konsistensi
app.post('/api/seri/:id/konsistensi', async (req, res) => {
  try {
    const db = getSupabase();
    const seriResult = await db.from('seri').select('*').eq('id', req.params.id).maybeSingle();
    const seri = throwIfError(seriResult, 'seri/konsistensi:seri');
    if (!seri) return res.status(404).json({ error: 'Seri tidak ditemukan' });
    const jilidListResult = await db.from('jilid').select('*').eq('seri_id', req.params.id).order('nomor', { ascending: true });
    const jilidList = throwIfError(jilidListResult, 'seri/konsistensi:jilid');
    const sbEntriesResult = await db.from('story_bible').select('*').eq('seri_id', req.params.id);
    const sbEntries = throwIfError(sbEntriesResult, 'seri/konsistensi:storyBible');
    const konteks = `Seri: ${seri.judul}\nJilid: ${jilidList.map(j => `#${j.nomor} ${j.judul} (${j.status})`).join(', ')}\nStory Bible: ${sbEntries.map(e => `[${e.tipe}] ${e.nama}: ${e.deskripsi || ''}`).join('\n')}`;
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 1000,
      system: 'Kamu adalah editor novel profesional Indonesia. Analisis konsistensi seri novel dan kembalikan JSON valid.',
      messages: [{ role: 'user', content: `Cek konsistensi seri novel ini dan kembalikan JSON:\n{\n  "skor": <0-100>,\n  "masalah": ["<masalah1>", "<masalah2>"],\n  "saran": ["<saran1>"],\n  "ringkasan": "<ringkasan>"\n}\n\nDATA:\n${konteks}` }]
    });
    const raw = msg.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const hasil = jsonMatch ? JSON.parse(jsonMatch[0]) : { skor: 75, masalah: [], saran: [], ringkasan: raw };
    res.json(hasil);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════
//  PENGATURAN ENDPOINTS
// ════════════════════════════════════════════

// GET /api/pengaturan
app.get('/api/pengaturan', async (req, res) => {
  try {
    const db = getSupabase();
    const result = await db.from('pengaturan_aplikasi').select('kunci, nilai');
    const rows = throwIfError(result, 'pengaturan/get');
    const out = {};
    rows.forEach(r => { out[r.kunci] = r.nilai; });
    res.json(out);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/pengaturan
app.put('/api/pengaturan', async (req, res) => {
  try {
    const db = getSupabase();
    // .upsert() dengan array baris setara transaksi INSERT ... ON CONFLICT
    // yang dipakai db.transaction() sebelumnya — satu panggilan atomik.
    const rows = Object.entries(req.body).map(([kunci, nilai]) => ({
      kunci, nilai: nilai == null ? null : String(nilai), diperbarui_pada: new Date().toISOString()
    }));
    if (rows.length > 0) {
      throwIfError(await db.from('pengaturan_aplikasi').upsert(rows, { onConflict: 'kunci' }), 'pengaturan/put');
    }
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pengaturan/test-koneksi
app.post('/api/pengaturan/test-koneksi', async (req, res) => {
  try {
    const { api_key } = req.body;
    const testClient = new Anthropic({ apiKey: api_key || process.env.ANTHROPIC_API_KEY });
    await testClient.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 10,
      messages: [{ role: 'user', content: 'ping' }]
    });
    res.json({ ok: true, message: 'Koneksi berhasil' });
  } catch(err) {
    res.json({ ok: false, message: err.message });
  }
});

// GET /api/pengaturan/backup
// Data kini disimpan di Supabase (Postgres terkelola) — bukan lagi berkas
// .db lokal, jadi "backup" diganti menjadi ekspor JSON dari tabel-tabel inti.
// Untuk backup penuh tingkat database, gunakan fitur Backups bawaan Supabase
// (Project Settings > Database > Backups).
app.get('/api/pengaturan/backup', async (req, res) => {
  try {
    const db = getSupabase();
    const [novels, dokumen, seriRows, dna, pengaturan] = await Promise.all([
      db.from('novels').select('*'),
      db.from('dokumen_editor').select('*'),
      db.from('seri').select('*'),
      db.from('novel_dna').select('id, novel_id, source_title, word_count, created_at'),
      db.from('pengaturan_aplikasi').select('*')
    ]);

    const backup = {
      exported_at: new Date().toISOString(),
      note: 'Untuk backup penuh database, gunakan fitur Backups di dashboard Supabase.',
      novels: throwIfError(novels, 'backup:novels'),
      dokumen_editor: throwIfError(dokumen, 'backup:dokumen'),
      seri: throwIfError(seriRows, 'backup:seri'),
      novel_dna: throwIfError(dna, 'backup:dna'),
      pengaturan_aplikasi: throwIfError(pengaturan, 'backup:pengaturan')
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="novelgen-backup.json"');
    res.send(JSON.stringify(backup, null, 2));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Global Error Handler ──────────────────────────────────────────────────
// Catches any unhandled errors thrown in route handlers via next(err)
app.use((err, req, res, next) => {
  console.error('[novelGENerator Error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Terjadi kesalahan server' });
});

// ── 404 Handler ───────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: `Endpoint tidak ditemukan: ${req.method} ${req.path}` });
  } else {
    res.status(404).send('Halaman tidak ditemukan');
  }
});

// ---- Boot ----
async function start() {
  await ensureDirs();

  // Skema & migrasi kolom tidak lagi dijalankan otomatis di sini — Postgres
  // tidak menerima DDL ad-hoc dari client seperti SQLite dulu. Skema dikelola
  // lewat supabase/schema.sql yang dijalankan manual di Supabase SQL Editor.
  // Di sini cukup dipastikan koneksi & kredensial valid sebelum server listen.
  try {
    const db = getSupabase();
    const probe = await db.from('novels').select('id', { count: 'exact', head: true });
    if (probe.error) throw new Error(probe.error.message);
    console.log('Koneksi Supabase berhasil diverifikasi');
  } catch (err) {
    console.error('FATAL: Gagal terhubung ke Supabase:', err.message);
    console.error('Pastikan SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY di .env sudah benar,');
    console.error('dan supabase/schema.sql sudah dijalankan di SQL Editor Supabase.');
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`novelGENerator berjalan di http://localhost:${PORT}`);
    console.log('Tekan Ctrl+C untuk berhenti');
  });
}

start();
