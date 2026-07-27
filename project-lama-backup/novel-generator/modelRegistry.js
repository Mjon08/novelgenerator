/*
 * MODEL REGISTRY
 * Katalog model AI gratis (OpenRouter free tier) beserta ukuran context window
 * dan batas laju-nya. Dipakai pipeline DNA untuk menentukan seberapa besar
 * potongan teks yang boleh dikirim dalam satu panggilan.
 *
 * Prinsip: makin besar context window, makin sedikit panggilan yang dibutuhkan
 * untuk membaca SELURUH novel — ini yang membuat analisis menyeluruh tetap
 * muat di kuota gratis.
 */

// Perkiraan konversi token → kata untuk Bahasa Indonesia.
// 1 token ≈ 0,75 kata untuk teks Latin; Bahasa Indonesia cenderung sedikit
// lebih boros token karena imbuhan, jadi dipakai angka konservatif.
const WORDS_PER_TOKEN = 0.6;

/*
 * context_tokens  — ukuran jendela konteks model
 * free            — true jika varian ini tidak menagih biaya (OpenRouter :free)
 * reasoning       — model dengan kemampuan penalaran bertahap, lebih baik untuk
 *                   sintesis level tinggi walau lebih lambat
 */
const MODELS = {
  // PERINGATAN: "openrouter/auto" adalah router BERBAYAR. Ia memilih model
  // terbaik yang tersedia (Gemini Flash, GPT, dsb.) dan menagih tarif model
  // itu. Jangan pernah menjadikannya nilai bawaan atau tujuan fallback —
  // lihat FREE_FALLBACK_CHAIN dan assertModelAllowed() di bawah.
  'openrouter/auto': {
    label: 'Otomatis Pilih AI Terbaik (BERBAYAR)',
    context_tokens: 128000,
    free: false,
    reasoning: false
  },

  // ── Model gratis: context sangat besar (ideal untuk baca novel utuh) ──
  'google/gemini-2.0-flash-exp:free': {
    label: 'Google Gemini 2.0 Flash (Gratis)',
    context_tokens: 1000000,
    free: true,
    reasoning: false
  },
  'meta-llama/llama-4-scout:free': {
    label: 'Meta Llama 4 Scout (Gratis)',
    context_tokens: 512000,
    free: true,
    reasoning: false
  },

  // ── Model gratis: context menengah ──
  'deepseek/deepseek-chat-v3-0324:free': {
    label: 'DeepSeek V3 (Gratis)',
    context_tokens: 64000,
    free: true,
    reasoning: false
  },
  'deepseek/deepseek-r1:free': {
    label: 'DeepSeek R1 — Penalaran (Gratis)',
    context_tokens: 64000,
    free: true,
    reasoning: true
  },
  'meta-llama/llama-3.3-70b-instruct:free': {
    label: 'Meta Llama 3.3 70B (Gratis)',
    context_tokens: 64000,
    free: true,
    reasoning: false
  },
  'qwen/qwen-2.5-72b-instruct:free': {
    label: 'Qwen 2.5 72B (Gratis)',
    context_tokens: 32000,
    free: true,
    reasoning: false
  },
  'mistralai/mistral-small-3.1-24b-instruct:free': {
    label: 'Mistral Small 3.1 24B (Gratis)',
    context_tokens: 96000,
    free: true,
    reasoning: false
  },

  // ── Model berbayar (tetap didukung bila pengguna memilihnya) ──
  'anthropic/claude-3.5-sonnet': {
    label: 'Anthropic Claude 3.5 Sonnet',
    context_tokens: 200000,
    free: false,
    reasoning: false
  },
  'claude-3-5-sonnet-20241022': {
    label: 'Claude 3.5 Sonnet (langsung Anthropic)',
    context_tokens: 200000,
    free: false,
    reasoning: false
  }
};

const DEFAULT_MODEL = 'google/gemini-2.0-flash-exp:free';

/*
 * Rantai cadangan GRATIS.
 *
 * Model gratis OpenRouter sering menolak permintaan sesaat (antrean penuh /
 * batas laju harian). Ketika itu terjadi, aplikasi harus pindah ke model
 * GRATIS berikutnya — BUKAN ke "openrouter/auto" yang berbayar. Urutan disusun
 * dari context window terbesar ke terkecil supaya potongan teks yang sudah
 * disiapkan tetap muat sejauh mungkin.
 */
const FREE_FALLBACK_CHAIN = [
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-4-scout:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen-2.5-72b-instruct:free'
];

/**
 * Model berbayar hanya boleh dipakai bila pengguna secara sadar mengizinkannya
 * lewat ALLOW_PAID_MODELS=true di .env. Bawaannya MATI, sehingga tidak ada
 * jalur kode yang bisa diam-diam menimbulkan tagihan.
 */
function paidModelsAllowed() {
  return String(process.env.ALLOW_PAID_MODELS || '').toLowerCase() === 'true';
}

/**
 * Pagar terakhir sebelum permintaan dikirim ke OpenRouter. Melempar error yang
 * jelas alih-alih menagih diam-diam.
 */
function assertModelAllowed(modelName) {
  if (isFreeModel(modelName) || paidModelsAllowed()) return;
  throw new Error(
    `[MODEL BERBAYAR DIBLOKIR] Permintaan ke "${modelName}" dibatalkan karena ` +
    `model ini menagih biaya. Pilih model bertanda "(Gratis)", atau setel ` +
    `ALLOW_PAID_MODELS=true di .env bila memang ingin memakai model berbayar.`
  );
}

/**
 * Model gratis berikutnya sesudah `modelName` gagal. Mengembalikan null bila
 * seluruh rantai sudah dicoba — pemanggil harus menyerah dengan error, bukan
 * beralih ke model berbayar.
 */
function nextFreeModel(modelName, sudahDicoba = []) {
  const terpakai = new Set([...sudahDicoba, modelName]);
  return FREE_FALLBACK_CHAIN.find(m => !terpakai.has(m)) || null;
}

// Batas laju free tier OpenRouter: 20 permintaan per menit.
// Dipakai throttle agar analisis hierarkis tidak ditolak server.
const FREE_TIER_RPM = 20;

function getModelInfo(modelName) {
  return MODELS[modelName] || {
    label: modelName || 'Model tidak dikenal',
    // Asumsi konservatif untuk model yang tidak ada di katalog, agar tidak
    // mengirim potongan yang melebihi context window-nya.
    context_tokens: 32000,
    free: String(modelName || '').includes(':free'),
    reasoning: false
  };
}

function isFreeModel(modelName) {
  return getModelInfo(modelName).free;
}

/**
 * Berapa kata yang aman dikirim dalam SATU panggilan ke model ini.
 * Disisakan ruang untuk prompt sistem, instruksi, dan token keluaran.
 */
function maxWordsPerCall(modelName, reservedTokens = 8000) {
  const info = getModelInfo(modelName);
  const usableTokens = Math.max(4000, info.context_tokens - reservedTokens);
  // Ambil 80% dari kapasitas agar ada margin aman terhadap estimasi token.
  return Math.floor(usableTokens * WORDS_PER_TOKEN * 0.8);
}

/**
 * Daftar model untuk ditampilkan di UI, model gratis didahulukan.
 */
function listModels() {
  return Object.entries(MODELS).map(([id, info]) => ({
    id,
    label: info.label,
    context_tokens: info.context_tokens,
    free: info.free,
    reasoning: info.reasoning
  })).sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    return b.context_tokens - a.context_tokens;
  });
}

/**
 * Throttle sederhana untuk menghormati batas laju free tier.
 * Menahan panggilan agar tidak melebihi FREE_TIER_RPM per menit.
 */
function createRateLimiter(rpm = FREE_TIER_RPM) {
  const intervalMs = Math.ceil(60000 / rpm);
  let lastCall = 0;

  return async function throttle() {
    const now = Date.now();
    const wait = lastCall + intervalMs - now;
    if (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
    }
    lastCall = Date.now();
  };
}

module.exports = {
  MODELS,
  DEFAULT_MODEL,
  FREE_FALLBACK_CHAIN,
  paidModelsAllowed,
  assertModelAllowed,
  nextFreeModel,
  FREE_TIER_RPM,
  WORDS_PER_TOKEN,
  getModelInfo,
  isFreeModel,
  maxWordsPerCall,
  listModels,
  createRateLimiter
};
