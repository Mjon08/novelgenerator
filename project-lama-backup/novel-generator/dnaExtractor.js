/*
 * DNA EXTRACTION ENGINE — pipeline hierarkis
 *
 * Menggantikan pendekatan lama yang hanya menyampel 2.500–3.000 kata per
 * dimensi. Sekarang SELURUH isi novel dibaca, lalu dianalisis bertingkat:
 *
 *   Level 1  Analisis adegan   — tiap potongan semantik dibaca penuh
 *   Level 2  Analisis bab      — pola per babak cerita, pacing antar bab
 *   Level 3  Sintesis novel    — DNA Blueprint akhir, 9 kategori
 *
 * Ukuran potongan menyesuaikan context window model, sehingga model
 * berjendela besar membaca novel utuh hanya dalam beberapa panggilan.
 *
 * Keluaran akhir adalah object terstruktur (DNA Blueprint), bukan paragraf
 * deskripsi, agar bisa dipakai ulang untuk menulis novel baru.
 */

const { getAnthropicAuth } = require('./auth');
const { parseFile } = require('./ingest');
const { getSupabase, throwIfError } = require('./database/supabaseClient');
const { preprocess } = require('./preprocessor');
const { buildChunkPlan } = require('./semanticChunker');
const {
  DEFAULT_MODEL,
  maxWordsPerCall,
  isFreeModel,
  createRateLimiter
} = require('./modelRegistry');

// Batas keluaran per panggilan. Jauh lebih besar dari versi lama (1200)
// karena analisis yang diminta memang menuntut jawaban terperinci.
const MAX_TOKENS_LEVEL1 = 2000;
const MAX_TOKENS_LEVEL2 = 2500;
const MAX_TOKENS_LEVEL3 = 4000;

// ── Pemanggil AI ────────────────────────────────────────────────────────────

function parseJSON(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '');

  // Buang pagar markdown bila model menyertakannya.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;

  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Tidak ada JSON pada respons AI');

  try {
    return JSON.parse(match[0]);
  } catch (e) {
    // Perbaikan lazim: koma menggantung dan kunci tanpa tanda kutip.
    const cleaned = match[0]
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":');
    return JSON.parse(cleaned);
  }
}

/**
 * Satu panggilan AI dengan throttle laju, percobaan ulang, dan parsing JSON.
 * Throttle dibagi satu instansi per ekstraksi agar batas 20 permintaan/menit
 * pada tier gratis tidak terlampaui.
 */
async function callAI(system, user, model, maxTokens, throttle, attempt = 0) {
  const client = getAnthropicAuth();
  if (throttle) await throttle();

  try {
    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    });
    const text = resp?.content?.[0]?.text || '';
    return parseJSON(text);
  } catch (err) {
    // Model gratis kadang menolak sesaat karena antrean; coba lagi dengan jeda.
    const retryable = /rate|limit|429|503|502|timeout|overload/i.test(err.message || '');
    if (attempt < 2 && retryable) {
      await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
      return callAI(system, user, model, maxTokens, throttle, attempt + 1);
    }
    throw err;
  }
}

// ── Pembersih nilai ─────────────────────────────────────────────────────────

function cleanVal(str, fallback = '') {
  if (typeof str === 'number' || typeof str === 'boolean') return str;
  if (typeof str !== 'string') return str || fallback;
  let s = str.trim();
  // Model kadang mengembalikan placeholder skema seperti "<pilih salah satu>".
  if (s.startsWith('<') && s.endsWith('>')) {
    return s.slice(1, -1).split('|')[0]?.trim() || fallback;
  }
  if (s.includes('<') && s.includes('>')) s = s.replace(/<[^>]+>/g, '').trim();
  return s || fallback;
}

function cleanArray(arr, fallback = []) {
  if (!Array.isArray(arr)) return fallback;
  const out = arr
    .map(x => (typeof x === 'object' && x !== null ? x : cleanVal(x)))
    .filter(x => x && (typeof x !== 'string' || (!x.startsWith('<') && !x.endsWith('>'))));
  return out.length ? out : fallback;
}

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

// ── LEVEL 1 — Analisis adegan ───────────────────────────────────────────────

const L1_SYSTEM = `Kamu adalah analis sastra profesional yang membedah CARA seorang penulis menulis, bukan menceritakan ulang isi ceritanya.

Tugasmu mengamati teknik penulisan: ritme kalimat, cara dialog dibangun, cara emosi dinaikkan, cara adegan dibuka dan ditutup.

JANGAN meringkas plot. JANGAN menilai bagus/jelek. Amati TEKNIKNYA.
Balas HANYA dengan JSON valid tanpa teks pembuka apa pun.`;

async function analyzeSceneChunk(chunk, ctx, model, throttle) {
  const user = `Analisis teknik penulisan pada potongan naskah berikut.

POSISI DALAM NOVEL: ${chunk.position} (bab ${chunk.chapter_span[0]}–${chunk.chapter_span[1]} dari total ${ctx.totalChapters} bab)
JUMLAH ADEGAN DI POTONGAN INI: ${chunk.scene_count}

Kembalikan JSON dengan struktur persis seperti ini:
{
  "narasi": {
    "pov": "orang-pertama | orang-ketiga-terbatas | orang-ketiga-omnisien | orang-kedua",
    "kala": "lampau | kini | campuran",
    "suara_naratif": "deskripsi 1 kalimat tentang nada narator",
    "monolog_batin": "bagaimana isi pikiran tokoh disampaikan",
    "kepadatan_deskripsi": "minimal | sedang | kaya | sangat-kaya",
    "rasio_eksposisi": "seberapa banyak penjelasan latar vs aksi langsung"
  },
  "kalimat": {
    "kompleksitas": "sederhana | sedang | kompleks | campuran",
    "ritme": "patah-patah | mengalir | bervariasi | arus-kesadaran",
    "pola_khas": "pola konstruksi kalimat yang berulang di potongan ini"
  },
  "dialog": {
    "ritme": "cepat-bolak-balik | lambat-reflektif | campuran",
    "jeda": "bagaimana jeda dan keheningan ditampilkan dalam percakapan",
    "narasi_di_sela": "bagaimana aksi/gestur disisipkan di antara dialog",
    "formalitas": "formal | semi-formal | santai | campuran",
    "sapaan": ["daftar kata sapaan yang dipakai antar tokoh"],
    "slang": ["kata gaul atau dialek yang muncul"]
  },
  "adegan": {
    "cara_dibuka": "teknik membuka adegan di potongan ini",
    "cara_ditutup": "teknik menutup adegan di potongan ini",
    "transisi": "cara berpindah antar adegan",
    "rasio_aksi": "dominan-aksi | dominan-dialog | dominan-narasi | seimbang"
  },
  "emosi": {
    "intensitas": 1-10,
    "cara_dinaikkan": "teknik menaikkan tegangan emosi",
    "momen_puncak": "apa yang terjadi saat emosi memuncak di potongan ini"
  },
  "gaya_bahasa": {
    "metafora": ["contoh metafora nyata dari teks, kutip apa adanya"],
    "analogi": ["contoh analogi nyata dari teks"],
    "repetisi": ["pola pengulangan kata/frasa yang disengaja"],
    "humor": "tidak-ada | halus | satir | slapstik | getir"
  },
  "kalimat_contoh": ["3 kalimat UTUH yang paling mewakili gaya penulis, kutip persis dari teks"]
}

NASKAH:
${chunk.content}`;

  const raw = await callAI(L1_SYSTEM, user, model, MAX_TOKENS_LEVEL1, throttle);
  return { chunk_index: chunk.index, position: chunk.position, chapter_span: chunk.chapter_span, ...raw };
}

// ── LEVEL 2 — Analisis kelompok bab ─────────────────────────────────────────

const L2_SYSTEM = `Kamu adalah analis struktur naratif. Kamu menerima data pembuka/penutup beberapa bab berurutan beserta hasil analisis adegan di dalamnya.

Tugasmu menemukan POLA yang berulang antar bab: cara penulis mengaitkan bab, membangun rasa penasaran, dan mengatur naik-turun tempo.

Balas HANYA dengan JSON valid.`;

async function analyzeChapterGroup(group, sceneFindings, ctx, model, throttle) {
  const chapterDigest = group.chapters.map(c =>
    `── BAB ${c.number}: ${c.title} (${c.word_count} kata, ${c.scene_count} adegan, dialog ${c.dialogue_ratio}%)
PEMBUKA: ${c.opening}
PENUTUP: ${c.closing}`
  ).join('\n\n');

  // Temuan Level 1 yang bersinggungan dengan rentang bab ini ikut disertakan
  // supaya analisis bab berpijak pada bacaan adegan, bukan menebak ulang.
  const relevant = sceneFindings.filter(f =>
    f.chapter_span && f.chapter_span[1] >= group.chapter_span[0] && f.chapter_span[0] <= group.chapter_span[1]
  );
  const sceneDigest = relevant.length
    ? relevant.map(f => `• [${f.position}] adegan dibuka: ${f?.adegan?.cara_dibuka || '-'} | ditutup: ${f?.adegan?.cara_ditutup || '-'} | intensitas emosi: ${f?.emosi?.intensitas ?? '-'}`).join('\n')
    : '(tidak ada)';

  const user = `Analisis pola antar bab pada bagian "${group.position}" novel ini (bab ${group.chapter_span[0]}–${group.chapter_span[1]} dari ${ctx.totalChapters} bab).

HASIL ANALISIS ADEGAN DI BAGIAN INI:
${sceneDigest}

DATA BAB:
${chapterDigest}

Kembalikan JSON dengan struktur persis seperti ini:
{
  "hook_bab": "pola bagaimana penulis mengaitkan pembaca di awal bab",
  "cliffhanger": "pola bagaimana bab ditutup agar pembaca lanjut membaca",
  "gaya_judul_bab": "pola penamaan judul bab",
  "pacing": "lambat | sedang | cepat | naik-turun",
  "eskalasi": "bagaimana konflik meningkat sepanjang bagian ini",
  "kurva_emosi": "naik | turun | naik-turun | datar",
  "momen_konflik": ["peristiwa yang memicu konflik di bagian ini, tulis sebagai POLA teknik bukan detail cerita"],
  "curiosity_gap": "informasi apa yang sengaja ditahan penulis dari pembaca",
  "reveal_timing": "kapan dan bagaimana penulis membuka rahasia",
  "payoff": "bagaimana penantian pembaca dibayar tuntas",
  "perkembangan_karakter": "bagaimana tokoh berubah di sepanjang bagian ini",
  "chemistry_antar_tokoh": "bagaimana kedekatan antar tokoh dibangun"
}`;

  const raw = await callAI(L2_SYSTEM, user, model, MAX_TOKENS_LEVEL2, throttle);
  return { group_index: group.index, position: group.position, chapter_span: group.chapter_span, ...raw };
}

// ── LEVEL 3 — Sintesis DNA Blueprint ────────────────────────────────────────

const L3_SYSTEM = `Kamu adalah pakar yang menyusun "DNA gaya penulisan" — cetak biru teknik seorang penulis agar dapat dipakai menulis karya BARU dengan rasa yang sama.

Kamu menerima hasil analisis seluruh isi novel di tingkat adegan dan tingkat bab, ditambah metrik terukur yang dihitung langsung dari teks.

ATURAN MUTLAK — DNA adalah CARA MENULIS, bukan ISI CERITA:
- DILARANG menyebut nama tokoh mana pun.
- DILARANG menyebut peristiwa, benda, atau istilah khas dari cerita ini
  (contoh yang dilarang: "tuntutan pembagian harta gono-gini", "usaha mebel").
- Tulis polanya secara umum sehingga berlaku untuk cerita apa pun.
  Contoh BENAR: "konflik meningkat lewat tuntutan hak material antar tokoh".
  Contoh SALAH: "konflik meningkat lewat tuntutan harta gono-gini".
- Setiap nilai harus spesifik sebagai TEKNIK dan bisa ditindaklanjuti penulis lain.
- Hormati metrik terukur yang diberikan; jangan mengarang angka yang bertentangan.

Balas HANYA dengan JSON valid.`;

/**
 * Sintesis dibagi tiga panggilan agar tiap bagian mendapat ruang keluaran
 * yang cukup. Menggabung semuanya dalam satu panggilan membuat model
 * memangkas jawaban dan hasilnya kembali dangkal.
 */
async function synthesizeStyleAndDialogue(digest, metrics, model, throttle) {
  const user = `Susun bagian GAYA PENULISAN dan DIALOG dari DNA penulis ini.

METRIK TERUKUR DARI TEKS (angka ini fakta, gunakan apa adanya):
- Rata-rata panjang kalimat: ${metrics.avg_sentence_length} kata
- Simpangan panjang kalimat: ${metrics.sentence_length_stddev} (makin besar makin bervariasi)
- Rata-rata kalimat per paragraf: ${metrics.avg_paragraph_sentences}
- Kekayaan kosakata: ${metrics.vocabulary_richness_pct}% kata unik
- Rasio dialog: ${metrics.dialogue_ratio}% | narasi: ${metrics.narration_ratio}%
- Rata-rata panjang satu dialog: ${metrics.avg_dialogue_length} kata

HASIL ANALISIS SELURUH NOVEL:
${digest}

Kembalikan JSON persis seperti ini:
{
  "style": {
    "pov": "",
    "tense": "",
    "narration_style": "",
    "internal_monologue": "",
    "descriptive_density": "",
    "exposition_ratio": "",
    "sentence_complexity": "",
    "sentence_rhythm": "",
    "paragraph_length": "",
    "vocabulary_richness": "",
    "emotional_intensity": "",
    "humor_level": "",
    "dramatic_level": "",
    "signature_technique": "teknik paling menonjol yang membedakan penulis ini"
  },
  "dialogue": {
    "avg_length": "",
    "rhythm": "",
    "pause_style": "",
    "action_beats": "cara menyisipkan gestur/aksi di sela dialog",
    "character_speech_style": "",
    "slang_usage": "",
    "formality": "",
    "address_terms": [],
    "tag_style": "cara menulis tag dialog (ujar/kata/tanya)"
  },
  "language_fingerprint": {
    "favorite_words": [],
    "favorite_phrases": [],
    "metaphor_pattern": "",
    "analogy_pattern": "",
    "humor_pattern": "",
    "repetition_pattern": "",
    "sensory_preference": ""
  }
}`;

  return callAI(L3_SYSTEM, user, model, MAX_TOKENS_LEVEL3, throttle);
}

async function synthesizeStructureAndEmotion(digest, overview, model, throttle) {
  const user = `Susun bagian STRUKTUR CERITA, POLA EMOSI, dan KETERIKATAN PEMBACA dari DNA penulis ini.

DATA STRUKTUR TERUKUR:
- Total bab: ${overview.total_chapters}
- Total adegan: ${overview.total_scenes}
- Rata-rata kata per bab: ${overview.avg_chapter_words}
- Kurva panjang bab: ${JSON.stringify(overview.chapter_word_curve.slice(0, 40))}
- Kurva rasio dialog per bab: ${JSON.stringify(overview.chapter_dialogue_curve.slice(0, 40))}
- Contoh judul bab: ${JSON.stringify(overview.chapter_titles.slice(0, 12))}

HASIL ANALISIS SELURUH NOVEL:
${digest}

Kembalikan JSON persis seperti ini:
{
  "structure": {
    "chapter_hook": "",
    "cliffhanger_style": "",
    "chapter_opening": "",
    "chapter_ending": "",
    "midpoint_technique": "",
    "pacing_pattern": "",
    "escalation_pattern": "",
    "chapter_title_style": "",
    "avg_chapter_words": ${overview.avg_chapter_words},
    "act_structure": "",
    "flashback_usage": ""
  },
  "emotion": {
    "rise_trigger": "apa yang membuat emosi naik",
    "fall_trigger": "apa yang membuat emosi mereda",
    "conflict_entry": "kapan dan bagaimana konflik dimunculkan",
    "curiosity_trigger": "cara membuat pembaca penasaran",
    "emotional_curve": "bentuk kurva emosi sepanjang novel",
    "peak_placement": "di bagian mana puncak emosi ditempatkan",
    "intensity_baseline": 1-10
  },
  "engagement": {
    "hook_pattern": "",
    "curiosity_gap": "",
    "suspense_technique": "",
    "reveal_timing": "",
    "payoff_style": "",
    "chapter_transition": ""
  },
  "scene_composition": {
    "scene_order": "",
    "transition_style": "",
    "scene_break_marker": "",
    "action_ratio": "",
    "dialogue_ratio": "",
    "narration_ratio": "",
    "avg_scenes_per_chapter": ${overview.total_chapters ? Math.round(overview.total_scenes / overview.total_chapters * 10) / 10 : 1}
  }
}`;

  return callAI(L3_SYSTEM, user, model, MAX_TOKENS_LEVEL3, throttle);
}

async function synthesizeCharacterAndGenre(digest, model, throttle) {
  const user = `Susun bagian PENCIPTAAN KARAKTER dan FORMULA GENRE dari DNA penulis ini.

HASIL ANALISIS SELURUH NOVEL:
${digest}

Untuk genre, deteksi dari daftar ini dan beri bobot persentase (total 100):
Romance, Drama Rumah Tangga, Thriller, Horror, Fantasy, Action, Historical, Comedy, Religious, Slice of Life, Mystery.
Jika campuran, sebutkan semua komponennya. Contoh: Romance 50, Drama Rumah Tangga 35, Comedy 15.

Kembalikan JSON persis seperti ini:
{
  "characters": {
    "introduction_method": "cara memperkenalkan tokoh baru",
    "development_method": "cara membangun kedalaman karakter",
    "conflict_emergence": "cara konflik antar tokoh muncul",
    "growth_arc": "pola perkembangan tokoh dari awal ke akhir",
    "chemistry_building": "cara membangun kedekatan antar tokoh",
    "emotional_arc": "pola naik turun emosi tokoh utama",
    "naming_style": "gaya penamaan tokoh",
    "protagonist_voice": "ciri khas suara tokoh utama",
    "antagonist_treatment": "cara memperlakukan tokoh antagonis"
  },
  "genre_formula": {
    "primary_genre": "",
    "genre_weights": [{"genre": "", "weight": 0}],
    "is_hybrid": true,
    "hybrid_label": "contoh: Romance + Drama Rumah Tangga + Comedy",
    "genre_conventions": ["konvensi genre yang dipatuhi penulis"],
    "target_reader": "",
    "platform_fit": "platform baca yang paling cocok untuk gaya ini"
  },
  "core_themes": ["tema inti yang berulang"],
  "moral_tone": "",
  "ending_tendency": ""
}`;

  return callAI(L3_SYSTEM, user, model, MAX_TOKENS_LEVEL3, throttle);
}

// ── Perakitan digest ────────────────────────────────────────────────────────

/**
 * Meringkas temuan Level 1 & 2 menjadi teks padat untuk Level 3.
 * Yang dikirim adalah hasil analisis, bukan naskah mentah, sehingga
 * sintesis akhir selalu muat dalam satu panggilan.
 */
function buildDigest(sceneFindings, groupFindings, fingerprint) {
  const scenes = sceneFindings.map(f => {
    const parts = [];
    if (f.narasi) parts.push(`POV ${f.narasi.pov}, kala ${f.narasi.kala}, suara: ${f.narasi.suara_naratif}; deskripsi ${f.narasi.kepadatan_deskripsi}; monolog batin: ${f.narasi.monolog_batin}`);
    if (f.kalimat) parts.push(`kalimat ${f.kalimat.kompleksitas}, ritme ${f.kalimat.ritme}, pola: ${f.kalimat.pola_khas}`);
    if (f.dialog) parts.push(`dialog ritme ${f.dialog.ritme}, jeda: ${f.dialog.jeda}, sela: ${f.dialog.narasi_di_sela}, formalitas ${f.dialog.formalitas}, sapaan: ${(f.dialog.sapaan || []).join('/')}`);
    if (f.adegan) parts.push(`adegan dibuka ${f.adegan.cara_dibuka}; ditutup ${f.adegan.cara_ditutup}; transisi ${f.adegan.transisi}; ${f.adegan.rasio_aksi}`);
    if (f.emosi) parts.push(`emosi ${f.emosi.intensitas}/10, dinaikkan lewat ${f.emosi.cara_dinaikkan}`);
    if (f.gaya_bahasa) parts.push(`metafora: ${(f.gaya_bahasa.metafora || []).slice(0, 2).join(' | ')}; humor ${f.gaya_bahasa.humor}; repetisi: ${(f.gaya_bahasa.repetisi || []).slice(0, 2).join(' | ')}`);
    return `[ADEGAN ${f.chunk_index} — ${f.position}]\n${parts.join('\n')}`;
  }).join('\n\n');

  const groups = groupFindings.map(g =>
    `[BAGIAN ${g.group_index} — ${g.position}, bab ${g.chapter_span?.[0]}–${g.chapter_span?.[1]}]
hook: ${g.hook_bab}; cliffhanger: ${g.cliffhanger}; pacing ${g.pacing}; eskalasi: ${g.eskalasi}
kurva emosi ${g.kurva_emosi}; curiosity gap: ${g.curiosity_gap}; reveal: ${g.reveal_timing}; payoff: ${g.payoff}
karakter: ${g.perkembangan_karakter}; chemistry: ${g.chemistry_antar_tokoh}`
  ).join('\n\n');

  const samples = sceneFindings
    .flatMap(f => f.kalimat_contoh || [])
    .filter(s => typeof s === 'string' && s.trim().length > 20)
    .slice(0, 12);

  return `=== ANALISIS TINGKAT ADEGAN ===
${scenes || '(tidak ada)'}

=== ANALISIS TINGKAT BAB ===
${groups || '(tidak ada)'}

=== KATA & FRASA PALING SERING (dihitung dari teks) ===
Kata: ${fingerprint.top_words.slice(0, 20).map(w => `${w.word}(${w.count})`).join(', ')}
Frasa: ${fingerprint.top_phrases.slice(0, 12).map(p => `"${p.phrase}"(${p.count})`).join(', ')}

=== KALIMAT CONTOH ASLI DARI NOVEL ===
${samples.map((s, i) => `${i + 1}. ${s}`).join('\n') || '(tidak ada)'}`;
}

// ── Validasi blueprint ──────────────────────────────────────────────────────

/**
 * Memastikan blueprint punya isi yang bermakna sebelum disimpan.
 * Mengembalikan daftar kekurangan agar bisa ditampilkan apa adanya ke
 * pengguna, bukan diam-diam menyimpan hasil kosong.
 */
function validateBlueprint(bp) {
  const issues = [];
  const required = ['style', 'dialogue', 'structure', 'emotion', 'engagement', 'characters', 'genre_formula', 'language_fingerprint', 'scene_composition'];

  for (const key of required) {
    const section = bp[key];
    if (!section || typeof section !== 'object') {
      issues.push(`Bagian "${key}" tidak terisi`);
      continue;
    }
    const filled = Object.values(section).filter(v => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== null && v !== undefined && String(v).trim() !== '';
    }).length;
    if (filled < 2) issues.push(`Bagian "${key}" hampir kosong (${filled} kolom terisi)`);
  }

  return { valid: issues.length === 0, issues };
}

// ── Orkestrator utama ───────────────────────────────────────────────────────

/**
 * Menjalankan seluruh pipeline dan mengembalikan DNA Blueprint.
 * onProgress dipanggil di setiap tahap agar UI bisa menampilkan proses
 * yang benar-benar berlangsung, bukan hasil instan.
 */
async function buildNovelDNA(filePath, title, chapterCountHint, onProgress, modelName) {
  const model = modelName || DEFAULT_MODEL;
  const throttle = createRateLimiter();
  const progress = (step, detail = {}) => { try { onProgress?.(step, detail); } catch (_) {} };

  // ── Tahap 1: baca file ──
  progress('reading', { message: 'Membaca berkas novel…' });
  const rawText = await parseFile(filePath, null);
  if (!rawText || !rawText.trim()) throw new Error('Berkas kosong atau tidak terbaca');

  // ── Tahap 2: preprocessing ──
  progress('preprocessing', { message: 'Membersihkan naskah & mendeteksi bab…' });
  const pre = preprocess(rawText);
  progress('chapters_detected', {
    message: `Terdeteksi ${pre.stats.chapter_count} bab, ${pre.stats.scene_count} adegan`,
    chapters: pre.stats.chapter_count,
    scenes: pre.stats.scene_count,
    words: pre.metrics.word_count,
    cleanup: pre.cleanup_report
  });

  // ── Tahap 3: rencana pemotongan semantik ──
  const plan = buildChunkPlan(pre, model);
  progress('chunking', {
    message: `Naskah dipotong menjadi ${plan.level1.length} unit analisis`,
    level1_chunks: plan.level1.length,
    level2_groups: plan.level2.length,
    estimated_calls: plan.plan.estimated_calls,
    coverage_pct: pre.metrics.word_count
      ? Math.round((plan.plan.coverage_words / pre.metrics.word_count) * 1000) / 10
      : 0
  });

  const ctx = { totalChapters: pre.stats.chapter_count };

  // ── Tahap 4: Level 1 — analisis tiap adegan ──
  progress('analyzing_scenes', { message: 'Memahami gaya penulisan per adegan…', total: plan.level1.length });
  const sceneFindings = [];
  for (const chunk of plan.level1) {
    try {
      const finding = await analyzeSceneChunk(chunk, ctx, model, throttle);
      sceneFindings.push(finding);
    } catch (err) {
      console.error(`[DNA L1 potongan ${chunk.index}]`, err.message);
      progress('scene_failed', { index: chunk.index, error: err.message });
    }
    progress('scene_done', {
      done: sceneFindings.length,
      total: plan.level1.length,
      message: `Adegan dianalisis ${sceneFindings.length}/${plan.level1.length}`
    });
  }

  if (sceneFindings.length === 0) {
    throw new Error('Semua analisis tingkat adegan gagal — periksa koneksi atau ganti model AI');
  }

  // ── Tahap 5: Level 2 — analisis kelompok bab ──
  progress('analyzing_chapters', { message: 'Mempelajari pacing & pola antar bab…', total: plan.level2.length });
  const groupFindings = [];
  for (const group of plan.level2) {
    try {
      const finding = await analyzeChapterGroup(group, sceneFindings, ctx, model, throttle);
      groupFindings.push(finding);
    } catch (err) {
      console.error(`[DNA L2 kelompok ${group.index}]`, err.message);
      progress('chapter_group_failed', { index: group.index, error: err.message });
    }
    progress('chapter_group_done', {
      done: groupFindings.length,
      total: plan.level2.length,
      message: `Bagian novel dianalisis ${groupFindings.length}/${plan.level2.length}`
    });
  }

  // ── Tahap 6: Level 3 — sintesis blueprint ──
  const digest = buildDigest(sceneFindings, groupFindings, pre.fingerprint);

  progress('synthesizing_style', { message: 'Menyusun DNA gaya & pola dialog…' });
  const partA = await synthesizeStyleAndDialogue(digest, pre.metrics, model, throttle)
    .catch(err => { console.error('[DNA L3 gaya]', err.message); return {}; });

  progress('synthesizing_structure', { message: 'Menyusun DNA struktur & pola emosi…' });
  const partB = await synthesizeStructureAndEmotion(digest, plan.level3, model, throttle)
    .catch(err => { console.error('[DNA L3 struktur]', err.message); return {}; });

  progress('synthesizing_character', { message: 'Menyusun DNA karakter & formula genre…' });
  const partC = await synthesizeCharacterAndGenre(digest, model, throttle)
    .catch(err => { console.error('[DNA L3 karakter]', err.message); return {}; });

  // ── Tahap 7: rakit blueprint ──
  progress('building_blueprint', { message: 'Merakit DNA Blueprint…' });

  const blueprint = {
    style: { ...(partA.style || {}) },
    dialogue: { ...(partA.dialogue || {}) },
    language_fingerprint: {
      ...(partA.language_fingerprint || {}),
      // Kata & frasa hasil hitung nyata selalu menang atas tebakan model.
      measured_top_words: pre.fingerprint.top_words.slice(0, 25),
      measured_top_phrases: pre.fingerprint.top_phrases.slice(0, 15)
    },
    structure: { ...(partB.structure || {}) },
    emotion: { ...(partB.emotion || {}) },
    engagement: { ...(partB.engagement || {}) },
    scene_composition: { ...(partB.scene_composition || {}) },
    characters: { ...(partC.characters || {}) },
    genre_formula: { ...(partC.genre_formula || {}) },
    core_themes: cleanArray(partC.core_themes, []),
    moral_tone: cleanVal(partC.moral_tone, ''),
    ending_tendency: cleanVal(partC.ending_tendency, ''),

    // Metrik terukur disimpan terpisah agar bisa dipakai sebagai target
    // kuantitatif saat menulis novel baru.
    measured_metrics: {
      ...pre.metrics,
      chapter_count: pre.stats.chapter_count,
      scene_count: pre.stats.scene_count,
      avg_chapter_words: pre.stats.avg_chapter_words,
      avg_scenes_per_chapter: pre.stats.chapter_count
        ? Math.round((pre.stats.scene_count / pre.stats.chapter_count) * 10) / 10
        : 0
    },

    sample_sentences: sceneFindings
      .flatMap(f => f.kalimat_contoh || [])
      .filter(s => typeof s === 'string' && s.trim().length > 20)
      .slice(0, 10),

    // Jejak proses supaya pengguna bisa memverifikasi novel benar dibaca utuh.
    extraction_meta: {
      model,
      is_free_model: isFreeModel(model),
      max_words_per_call: maxWordsPerCall(model),
      level1_chunks_planned: plan.level1.length,
      level1_chunks_analyzed: sceneFindings.length,
      level2_groups_planned: plan.level2.length,
      level2_groups_analyzed: groupFindings.length,
      total_ai_calls: sceneFindings.length + groupFindings.length + 3,
      words_read: plan.plan.coverage_words,
      total_words: pre.metrics.word_count,
      coverage_pct: pre.metrics.word_count
        ? Math.round((plan.plan.coverage_words / pre.metrics.word_count) * 1000) / 10
        : 0,
      cleanup_report: pre.cleanup_report
    }
  };

  // ── Tahap 8: validasi ──
  progress('validating', { message: 'Memvalidasi blueprint…' });
  const validation = validateBlueprint(blueprint);
  blueprint.validation = validation;
  if (!validation.valid) {
    console.warn('[DNA] Blueprint tidak lengkap:', validation.issues.join('; '));
  }

  const dna = {
    source_title: title,
    source_word_count: pre.metrics.word_count,
    extraction_date: new Date().toISOString(),
    blueprint,

    // Bentuk lama dipertahankan agar mimicryAgent dan halaman yang sudah ada
    // tetap berjalan tanpa perubahan.
    ...toLegacyShape(blueprint)
  };

  // ── Tahap 9: simpan ──
  const db = getSupabase();
  // Dua query .eq() terpisah dipakai alih-alih .or() string PostgREST, karena
  // .or() rentan rusak bila filePath/title mengandung koma atau tanda kutip.
  const byPathResult = await db.from('novels').select('id').eq('file_path', filePath).limit(1).maybeSingle();
  let existing = throwIfError(byPathResult, 'buildNovelDNA:cekNovelByPath');
  if (!existing) {
    const byTitleResult = await db.from('novels').select('id').eq('title', title).limit(1).maybeSingle();
    existing = throwIfError(byTitleResult, 'buildNovelDNA:cekNovelByTitle');
  }
  const novelId = existing?.id ?? null;

  const insertResult = await db.from('novel_dna').insert({
    novel_id: novelId,
    source_title: title,
    language_json: JSON.stringify(dna.language),
    style_json: JSON.stringify(dna.style),
    structure_json: JSON.stringify(dna.structure),
    character_json: JSON.stringify(dna.character),
    human_touch_json: JSON.stringify(dna.human_touch),
    thematic_json: JSON.stringify(dna.thematic),
    full_dna_json: JSON.stringify(dna),
    blueprint_json: JSON.stringify(blueprint),
    // Disimpan agar pemeriksaan orisinalitas selalu punya pembanding,
    // termasuk saat DNA berasal dari berkas unggahan.
    source_text: pre.text,
    word_count: pre.metrics.word_count
  }).select('id').single();
  const inserted = throwIfError(insertResult, 'buildNovelDNA:insert');

  dna.dna_id = inserted.id;
  progress('ready', {
    message: 'DNA Blueprint siap digunakan',
    dna_id: dna.dna_id,
    validation,
    meta: blueprint.extraction_meta
  });

  return dna;
}

/**
 * Memetakan blueprint baru ke bentuk enam-dimensi yang lama.
 * Ini menjaga mimicryAgent.js, evaluator.js, dan kartu hasil di UI tetap
 * berfungsi tanpa harus ditulis ulang.
 */
function toLegacyShape(bp) {
  const st = bp.style || {};
  const dl = bp.dialogue || {};
  const str = bp.structure || {};
  const ch = bp.characters || {};
  const lf = bp.language_fingerprint || {};
  const gf = bp.genre_formula || {};
  const mm = bp.measured_metrics || {};

  return {
    language: {
      vocabulary_level: cleanVal(st.vocabulary_richness, 'sedang'),
      dominant_language: 'Bahasa Indonesia',
      sentence_avg_length: Math.round(num(mm.avg_sentence_length, 15)),
      punctuation_style: cleanVal(st.sentence_rhythm, 'bervariasi'),
      paragraph_avg_length: Math.round(num(mm.avg_paragraph_sentences, 4)),
      special_words: (lf.measured_top_words || []).slice(0, 10).map(w => w.word),
      slang_or_dialect: cleanArray(dl.slang_usage ? [dl.slang_usage] : [], []),
      foreign_words_usage: 'minimal'
    },
    style: {
      pov: cleanVal(st.pov, 'orang-ketiga-terbatas'),
      tense: cleanVal(st.tense, 'lampau'),
      narrative_voice_tone: cleanVal(st.narration_style, ''),
      sentence_rhythm: cleanVal(st.sentence_rhythm, 'bervariasi'),
      description_density: cleanVal(st.descriptive_density, 'sedang'),
      dialogue_ratio: Math.round(num(mm.dialogue_ratio, 30)),
      internal_monologue_style: cleanVal(st.internal_monologue, ''),
      metaphor_frequency: cleanVal(lf.metaphor_pattern, 'kadang'),
      signature_phrases: (lf.measured_top_phrases || []).slice(0, 8).map(p => p.phrase),
      sample_sentences: bp.sample_sentences || []
    },
    structure: {
      total_chapters: Math.round(num(mm.chapter_count, 10)),
      avg_chapter_length_words: Math.round(num(str.avg_chapter_words || mm.avg_chapter_words, 2000)),
      chapter_opening_style: cleanVal(str.chapter_opening, ''),
      chapter_closing_style: cleanVal(str.cliffhanger_style, ''),
      plot_structure: cleanVal(str.act_structure, 'linear'),
      act_structure: cleanVal(str.act_structure, '3 babak'),
      pacing_pattern: cleanVal(str.pacing_pattern, ''),
      flashback_usage: /ya|sering|ada|digunakan/i.test(String(str.flashback_usage || '')),
      chapter_title_style: cleanVal(str.chapter_title_style, '')
    },
    character: {
      protagonist_voice: cleanVal(ch.protagonist_voice, ''),
      dialogue_style: cleanVal(dl.character_speech_style, ''),
      character_intro_pattern: cleanVal(ch.introduction_method, ''),
      relationship_dynamics: cleanVal(ch.chemistry_building, ''),
      emotional_expression_style: cleanVal(ch.emotional_arc, ''),
      character_names_style: cleanVal(ch.naming_style, '')
    },
    human_touch: {
      filler_expressions: (lf.favorite_words || []).slice(0, 8),
      emotional_leakage: cleanVal((bp.emotion || {}).rise_trigger, ''),
      imperfection_markers: cleanArray(lf.repetition_pattern ? [lf.repetition_pattern] : [], []),
      humor_style: cleanVal(st.humor_level || lf.humor_pattern, 'halus'),
      tension_build_technique: cleanVal((bp.engagement || {}).suspense_technique, ''),
      sensory_preference: cleanVal(lf.sensory_preference, 'seimbang'),
      breathing_rhythm: cleanVal(st.paragraph_length, '')
    },
    thematic: {
      core_themes: bp.core_themes || [],
      moral_ambiguity_level: cleanVal(bp.moral_tone, 'abu-abu'),
      genre_blend: (gf.genre_weights || []).map(g => g.genre).filter(Boolean),
      world_building_style: cleanVal(st.descriptive_density, ''),
      ending_tendency: cleanVal(bp.ending_tendency, '')
    }
  };
}

// ── Pembacaan dari basis data ───────────────────────────────────────────────

async function getDNAById(dnaId) {
  const db = getSupabase();
  const result = await db.from('novel_dna').select('*').eq('id', dnaId).maybeSingle();
  const row = throwIfError(result, 'getDNAById');
  if (!row) return null;

  // Profil hasil ekstraksi baru menyimpan seluruh objek di full_dna_json.
  // Profil lama tidak punya blueprint — tetap dilayani dari kolom per-dimensi.
  let full = {};
  try { full = JSON.parse(row.full_dna_json || '{}'); } catch (_) {}

  let blueprint = null;
  try { blueprint = row.blueprint_json ? JSON.parse(row.blueprint_json) : (full.blueprint || null); } catch (_) {}

  return {
    dna_id: row.id,
    novel_id: row.novel_id,
    source_title: row.source_title,
    source_word_count: row.word_count,
    extraction_date: row.created_at,
    blueprint,
    language: JSON.parse(row.language_json || '{}'),
    style: JSON.parse(row.style_json || '{}'),
    structure: JSON.parse(row.structure_json || '{}'),
    character: JSON.parse(row.character_json || '{}'),
    human_touch: JSON.parse(row.human_touch_json || '{}'),
    thematic: JSON.parse(row.thematic_json || '{}')
  };
}

/**
 * Mengambil naskah sumber sebuah DNA untuk pemeriksaan orisinalitas.
 * Dipisahkan dari getDNAById agar teks yang bisa mencapai jutaan karakter
 * tidak ikut termuat pada setiap pembacaan profil.
 *
 * Mengembalikan string kosong bila DNA lama tidak menyimpan naskahnya.
 */
async function getDNASourceText(dnaId) {
  const db = getSupabase();
  const result = await db.from('novel_dna').select('source_text, novel_id').eq('id', dnaId).maybeSingle();
  const row = throwIfError(result, 'getDNASourceText');
  if (!row) return '';
  if (row.source_text) return row.source_text;

  // DNA versi lama: coba ambil dari novel tertaut bila ada.
  if (row.novel_id) {
    const novelResult = await db.from('novels').select('full_text').eq('id', row.novel_id).maybeSingle();
    const novel = throwIfError(novelResult, 'getDNASourceText:novel');
    if (novel?.full_text) return novel.full_text;
  }
  return '';
}

async function listAllDNA() {
  const db = getSupabase();
  const result = await db
    .from('novel_dna')
    .select('id, novel_id, source_title, word_count, created_at, language_json, style_json, thematic_json, blueprint_json')
    .order('created_at', { ascending: false });
  const rows = throwIfError(result, 'listAllDNA');

  return rows.map(row => {
    let bp = null;
    try { bp = row.blueprint_json ? JSON.parse(row.blueprint_json) : null; } catch (_) {}
    return {
      dna_id: row.id,
      novel_id: row.novel_id,
      source_title: row.source_title,
      word_count: row.word_count,
      created_at: row.created_at,
      // Menandai profil lama agar UI bisa menyarankan ekstraksi ulang.
      has_blueprint: Boolean(bp),
      coverage_pct: bp?.extraction_meta?.coverage_pct ?? null,
      genre: bp?.genre_formula?.hybrid_label || bp?.genre_formula?.primary_genre || null,
      language_preview: JSON.parse(row.language_json || '{}'),
      style_preview: JSON.parse(row.style_json || '{}'),
      thematic_preview: JSON.parse(row.thematic_json || '{}')
    };
  });
}

module.exports = {
  buildNovelDNA,
  getDNAById,
  getDNASourceText,
  listAllDNA,
  validateBlueprint,
  toLegacyShape,
  analyzeSceneChunk,
  analyzeChapterGroup,
  buildDigest
};
