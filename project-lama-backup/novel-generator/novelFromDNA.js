/*
 * GENERATE NEW NOVEL FROM DNA
 *
 * Menulis novel BARU yang mewarisi gaya penulisan dari DNA Blueprint,
 * namun dengan cerita, tokoh, konflik, dan alur yang sepenuhnya orisinal.
 *
 * Yang diwariskan  : teknik menulis (ritme, pacing, cara bangun emosi, dst.)
 * Yang TIDAK diwariskan : nama tokoh, plot, konflik, dialog, dan ending asli.
 *
 * Konfigurasi mengikuti form pada PRD: genre, tema, tokoh, POV, panjang,
 * kekuatan peniruan gaya, kepadatan emosi/dialog/deskripsi, dan platform target.
 */

const { getAnthropicAuth } = require('./auth');
const { DEFAULT_MODEL, createRateLimiter } = require('./modelRegistry');

// ── Katalog pilihan form ────────────────────────────────────────────────────

const GENRES = [
  'Romance', 'Family Drama', 'Drama Rumah Tangga', 'Horror', 'Fantasy',
  'Action', 'Thriller', 'Mystery', 'Religious', 'Comedy', 'Historical', 'Slice of Life'
];

const POV_OPTIONS = {
  'orang-pertama': 'Orang Pertama ("aku")',
  'orang-ketiga': 'Orang Ketiga terbatas ("dia")',
  'multi-pov': 'Multi POV — berganti sudut pandang antar bab',
  'auto': 'Auto — ikuti sudut pandang pada DNA'
};

// Panjang cerita → rentang bab dan target kata per bab.
const STORY_LENGTHS = {
  cerpen: { label: 'Cerpen', chapters: 1, words_per_chapter: 3000 },
  novella: { label: 'Novella', chapters: 12, words_per_chapter: 2000 },
  'novel-pendek': { label: 'Novel Pendek', chapters: 30, words_per_chapter: 2000 },
  'novel-panjang': { label: 'Novel Panjang', chapters: 60, words_per_chapter: 2200 }
};

// Seberapa kuat gaya DNA ditiru.
const STYLE_STRENGTH = {
  100: 'Tiru gaya penulis SEPERSIS mungkin. Setiap parameter DNA adalah aturan wajib.',
  75: 'Ikuti gaya penulis secara dominan, namun boleh sedikit variasi alami agar tidak kaku.',
  50: 'Ambil setengah karakter gaya penulis, padukan dengan suara netral yang bersih.',
  25: 'Sekadar terinspirasi gaya penulis. Utamakan keterbacaan umum.'
};

const EMOTION_LEVELS = {
  soft: 'Emosi ditahan dan halus. Konflik disampaikan lewat ketegangan tersirat.',
  medium: 'Emosi wajar dan seimbang, naik-turun mengikuti kebutuhan adegan.',
  high: 'Emosi kuat dan terasa. Konflik terbuka, air mata dan amarah tidak disembunyikan.',
  extreme: 'Emosi sangat intens dan menghantam. Setiap bab meninggalkan luka bagi pembaca.'
};

const DIALOGUE_DENSITY = {
  sedikit: { label: 'Sedikit', target: 15 },
  normal: { label: 'Normal', target: 30 },
  banyak: { label: 'Banyak', target: 50 },
  'sangat-banyak': { label: 'Sangat Banyak', target: 65 }
};

const DESCRIPTION_DENSITY = {
  minimal: 'Deskripsi seperlunya. Langsung ke aksi dan percakapan.',
  sedang: 'Deskripsi secukupnya untuk membangun suasana tanpa memperlambat cerita.',
  detail: 'Deskripsi kaya. Latar, gestur, dan suasana digambarkan jelas.',
  'sangat-detail': 'Deskripsi sangat rinci dan sinematik pada setiap adegan penting.'
};

const READING_LEVELS = {
  remaja: 'Pembaca remaja. Bahasa lugas, kalimat tidak berbelit, tanpa konten dewasa eksplisit.',
  dewasa: 'Pembaca dewasa. Tema dan konflik boleh kompleks dan berat.',
  umum: 'Pembaca umum lintas usia. Aman namun tetap berbobot.'
};

const LANGUAGE_STYLES = {
  santai: 'Bahasa santai dan mengalir, dekat dengan percakapan sehari-hari.',
  formal: 'Bahasa formal, rapi, dan tertata.',
  puitis: 'Bahasa puitis dengan citraan dan metafora yang kuat.',
  dramatis: 'Bahasa dramatis dengan tekanan emosi di setiap peristiwa penting.',
  natural: 'Bahasa natural, tidak dibuat-buat, terasa manusiawi.'
};

// Karakter penyajian tiap platform baca.
const PLATFORMS = {
  KBM: 'KBM App — bab pendek, konflik cepat muncul, cliffhanger tiap akhir bab, gaya bahasa membumi.',
  Fizzo: 'Fizzo — hook sangat cepat di 3 paragraf pertama, bab pendek, emosi tinggi, banyak dialog.',
  GoodNovel: 'GoodNovel — pola drama romantis, eskalasi konflik jelas, bab berakhir menggantung.',
  Dreame: 'Dreame — fokus pada ketegangan romantis dan konflik personal, ritme cepat.',
  Wattpad: 'Wattpad — suara naratif akrab dengan pembaca, gaya bebas dan ekspresif.',
  Hinovel: 'Hinovel — konflik langsung, tempo cepat, adegan emosional yang tegas.',
  Umum: 'Umum — gaya penyajian netral yang cocok untuk berbagai platform.'
};

// ── Penyusun prompt ─────────────────────────────────────────────────────────

function val(v, fallback = '') {
  return v !== undefined && v !== null && String(v).trim() !== '' ? String(v) : fallback;
}

function list(v, fallback = '') {
  if (Array.isArray(v) && v.length) {
    return v.map(x => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ');
  }
  return val(v, fallback);
}

/**
 * Mengumpulkan nama diri dari novel sumber.
 *
 * Model penganalisis sering menyelipkan nama tokoh ke dalam deskripsi teknik
 * ("Nama tokoh sentral Raka, Rafael, Amel sering diulang"). Bila teks itu
 * diteruskan mentah ke prompt penulisan, novel baru berisiko memakai nama —
 * bahkan alur — dari cerita lama. Nama-nama ini dikumpulkan agar bisa disensor
 * lebih dulu.
 */
function collectSourceNames(blueprint) {
  const names = new Set();
  const lf = blueprint.language_fingerprint || {};

  // Kata yang sangat sering muncul dan berbentuk nama diri hampir pasti tokoh.
  for (const entry of lf.measured_top_words || []) {
    const w = entry.word || '';
    if (w.length >= 3 && !/\d/.test(w)) names.add(w.toLowerCase());
  }

  // Kata bersapaan pada blueprint dialog sering memuat nama ("Mas Raka").
  for (const term of lf.address_terms || (blueprint.dialogue || {}).address_terms || []) {
    for (const part of String(term).split(/\s+/)) {
      if (part.length >= 3) names.add(part.toLowerCase());
    }
  }

  return names;
}

// Kata umum yang kebetulan sering muncul namun bukan nama tokoh.
const NOT_NAMES = new Set([
  'rumah','anak','lagi','setelah','sama','ingin','orang','kalau','saat','tahu','selalu',
  'pergi','sangat','benar','tidak','sudah','masih','hanya','bisa','akan','dari','yang',
  'sakit','tahun','semua','diam','harta','usaha','suami','istri','ayah','ibu','mertua',
  'anda','kamu','saya','mereka','dia','mbak','mas','tante','nona','pak','bu'
]);

/**
 * Menyensor nama tokoh dari sepotong teks blueprint.
 * Yang tersisa tetap menjelaskan tekniknya, tanpa membawa identitas cerita lama.
 */
function redactNames(text, names) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;

  for (const name of names) {
    if (NOT_NAMES.has(name) || name.length < 4) continue;
    // Hanya sensor bila muncul sebagai kata utuh berawalan huruf kapital,
    // yaitu bentuk yang menandakan nama diri.
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, match => (/^[A-Z]/.test(match) ? '[tokoh]' : match));
  }

  return out;
}

/**
 * Menyensor frasa khas novel sumber (mis. "harta gono gini", "usaha mebel").
 * Frasa semacam ini adalah detail plot, bukan teknik menulis, sehingga tidak
 * boleh ikut ke prompt penulisan walau muncul di deskripsi teknik.
 */
function redactSourcePhrases(text, phrases) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;

  for (const phrase of phrases) {
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;
    // Cocokkan longgar: spasi atau tanda hubung di antara kata, agar
    // "gono gini" juga menangkap penulisan "gono-gini".
    const pattern = words
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[\\s-]+');
    out = out.replace(new RegExp(`\\b${pattern}\\b`, 'gi'), '[detail cerita sumber]');
  }

  return out;
}

/**
 * Membersihkan seluruh nilai teks pada blueprint dari nama tokoh dan
 * frasa khas novel sumber.
 * Dijalankan tepat sebelum blueprint dipakai menyusun prompt penulisan.
 */
function sanitizeBlueprintForGeneration(blueprint) {
  const names = collectSourceNames(blueprint);
  const lf = blueprint.language_fingerprint || {};
  const phrases = (lf.measured_top_phrases || [])
    .map(p => p.phrase)
    .filter(Boolean);

  const walk = (value) => {
    if (typeof value === 'string') return redactSourcePhrases(redactNames(value, names), phrases);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };

  const clean = walk(blueprint);

  // Daftar kata & frasa terukur dibuang seluruhnya dari jalur penulisan:
  // isinya didominasi nama tokoh dan kata kunci plot novel sumber, sehingga
  // lebih berisiko mencemari cerita baru daripada berguna sebagai penanda gaya.
  if (clean.language_fingerprint) {
    delete clean.language_fingerprint.measured_top_words;
    delete clean.language_fingerprint.measured_top_phrases;
    delete clean.language_fingerprint.favorite_words;
    delete clean.language_fingerprint.favorite_phrases;
  }
  // Kalimat contoh adalah kutipan harfiah dari novel sumber — tidak boleh
  // ikut ke prompt penulisan agar tidak tersalin.
  delete clean.sample_sentences;

  return clean;
}

/**
 * Menerjemahkan DNA Blueprint menjadi seperangkat aturan menulis.
 * Hanya aspek TEKNIK yang diambil — tidak ada satu pun elemen cerita asli.
 */
function buildStyleRules(blueprint, config) {
  const st = blueprint.style || {};
  const dl = blueprint.dialogue || {};
  const str = blueprint.structure || {};
  const em = blueprint.emotion || {};
  const en = blueprint.engagement || {};
  const ch = blueprint.characters || {};
  const lf = blueprint.language_fingerprint || {};
  const sc = blueprint.scene_composition || {};
  const mm = blueprint.measured_metrics || {};

  const strength = STYLE_STRENGTH[config.style_strength] || STYLE_STRENGTH[75];

  // POV: "auto" mengikuti DNA, selain itu perintah pengguna yang menang.
  const pov = config.pov === 'auto'
    ? val(st.pov, 'orang-ketiga-terbatas')
    : val(POV_OPTIONS[config.pov], config.pov);

  const dialogueTarget = (DIALOGUE_DENSITY[config.dialogue_density] || DIALOGUE_DENSITY.normal).target;

  return `═══ KEKUATAN PENIRUAN GAYA ═══
${strength}

═══ ATURAN NARASI ═══
• Sudut pandang: ${pov}
• Kala: ${val(st.tense, 'lampau')}
• Gaya narasi: ${val(st.narration_style, 'natural')}
• Monolog batin: ${val(st.internal_monologue, 'disisipkan wajar')}
• Rasio eksposisi: ${val(st.exposition_ratio, 'seimbang')}
• Teknik khas penulis: ${val(st.signature_technique, '-')}

═══ ATURAN KALIMAT ═══
• Kompleksitas: ${val(st.sentence_complexity, 'sedang')}
• Ritme: ${val(st.sentence_rhythm, 'bervariasi')}
• Rata-rata panjang kalimat: ~${Math.round(mm.avg_sentence_length || 15)} kata
• Rata-rata kalimat per paragraf: ~${Math.round(mm.avg_paragraph_sentences || 4)}
• Kekayaan kosakata sasaran: ~${mm.vocabulary_richness_pct || 30}% kata unik

═══ ATURAN DIALOG ═══
• Porsi dialog sasaran: ~${dialogueTarget}% dari teks (dipilih pengguna)
• Ritme dialog: ${val(dl.rhythm, 'bervariasi')}
• Cara memberi jeda: ${val(dl.pause_style, 'natural')}
• Aksi/gestur di sela dialog: ${val(dl.action_beats, 'disisipkan wajar')}
• Gaya tag dialog: ${val(dl.tag_style, 'sederhana')}
• Tingkat formalitas: ${val(dl.formality, 'santai')}
• Kata sapaan khas: ${list(dl.address_terms, 'sesuaikan konteks')}
• Rata-rata panjang satu dialog: ~${Math.round(mm.avg_dialogue_length || 12)} kata

═══ ATURAN STRUKTUR ═══
• Cara membuka bab: ${val(str.chapter_opening, 'langsung ke adegan')}
• Hook bab: ${val(str.chapter_hook, 'pertanyaan yang menggantung')}
• Cliffhanger: ${val(str.cliffhanger_style, 'akhiri saat tegangan memuncak')}
• Pola pacing: ${val(str.pacing_pattern, 'naik bertahap')}
• Pola eskalasi: ${val(str.escalation_pattern, 'konflik meningkat tiap babak')}
• Gaya judul bab: ${val(str.chapter_title_style, 'judul singkat tematik')}
• Komposisi adegan: ${val(sc.scene_order, 'kronologis')}, transisi ${val(sc.transition_style, 'halus')}
• Rata-rata adegan per bab: ~${sc.avg_scenes_per_chapter || 2}

═══ ATURAN EMOSI & KETERIKATAN PEMBACA ═══
• Pemicu emosi naik: ${val(em.rise_trigger, 'konflik personal')}
• Pemicu emosi mereda: ${val(em.fall_trigger, 'momen refleksi')}
• Cara memunculkan konflik: ${val(em.conflict_entry, 'bertahap')}
• Cara membuat penasaran: ${val(em.curiosity_trigger, 'menahan informasi kunci')}
• Pola hook: ${val(en.hook_pattern, 'buka dengan pertanyaan')}
• Celah rasa ingin tahu: ${val(en.curiosity_gap, 'sembunyikan motif tokoh')}
• Teknik suspense: ${val(en.suspense_technique, 'tunda pengungkapan')}
• Waktu membuka rahasia: ${val(en.reveal_timing, 'menjelang klimaks')}
• Cara membayar penantian: ${val(en.payoff_style, 'tuntas dan memuaskan')}

═══ ATURAN KARAKTER ═══
• Cara memperkenalkan tokoh: ${val(ch.introduction_method, 'lewat aksi')}
• Cara membangun kedalaman: ${val(ch.development_method, 'lewat pilihan sulit')}
• Cara konflik antar tokoh muncul: ${val(ch.conflict_emergence, 'perbedaan tujuan')}
• Pola perkembangan tokoh: ${val(ch.growth_arc, 'berubah setelah kehilangan')}
• Cara membangun chemistry: ${val(ch.chemistry_building, 'lewat interaksi berulang')}
• Suara tokoh utama: ${val(ch.protagonist_voice, 'khas dan konsisten')}
• Perlakuan terhadap antagonis: ${val(ch.antagonist_treatment, 'punya alasan yang masuk akal')}

═══ SIDIK JARI BAHASA ═══
• Pola metafora: ${val(lf.metaphor_pattern, 'sederhana dan membumi')}
• Pola analogi: ${val(lf.analogy_pattern, '-')}
• Pola humor: ${val(lf.humor_pattern, 'halus')}
• Pola repetisi yang disengaja: ${val(lf.repetition_pattern, '-')}
• Preferensi indrawi: ${val(lf.sensory_preference, 'visual')}

CATATAN: yang ditiru adalah POLA pemakaian bahasa di atas, bukan kosakata
tertentu dari novel sumber. Pilih kata sendiri yang sesuai cerita barumu.`;
}

/**
 * Aturan orisinalitas — bagian paling penting dari PRD.
 * Novel baru tidak boleh mewarisi apa pun selain teknik menulis.
 */
function buildOriginalityRules(dnaTitle, config) {
  const allowOldNames = config.allow_original_names === true;

  return `═══ ATURAN ORISINALITAS (WAJIB, TIDAK BOLEH DILANGGAR) ═══
Novel yang kamu tulis HARUS sepenuhnya orisinal. Yang diwarisi dari novel "${dnaTitle}" HANYA cara menulisnya.

DILARANG KERAS:
• Menyalin kalimat mana pun dari novel sumber
• Memparafrasekan adegan dari novel sumber
• Menulis ulang atau meringkas cerita sumber
• Memakai plot, konflik, atau alur cerita sumber
• Memakai dialog dari novel sumber
• Memakai ending novel sumber
${allowOldNames ? '• (Pengguna mengizinkan pemakaian nama tokoh lama)' : '• Memakai nama tokoh dari novel sumber'}

YANG WAJIB BARU:
• Premis cerita
• Seluruh tokoh beserta nama dan latar belakangnya
• Konflik utama dan konflik sampingan
• Seluruh dialog
• Alur dari awal hingga akhir
• Ending

Jika kamu merasa sedang menulis sesuatu yang mirip cerita sumber, HENTIKAN dan ganti dengan gagasan lain.`;
}

/**
 * Deskripsi tokoh yang ditentukan pengguna, dirangkai jadi bagian prompt.
 */
function buildCharacterBrief(characters, count) {
  if (!Array.isArray(characters) || characters.length === 0) {
    return `Ciptakan ${count} tokoh utama yang orisinal beserta relasi antar mereka. Tentukan sendiri nama, usia, pekerjaan, kepribadian, latar belakang, tujuan, rahasia, dan motivasi masing-masing agar saling mengikat dalam konflik.`;
  }

  const defined = characters.map((c, i) => {
    const fields = [
      c.nama && `Nama: ${c.nama}`,
      c.usia && `Usia: ${c.usia}`,
      c.gender && `Gender: ${c.gender}`,
      c.pekerjaan && `Pekerjaan: ${c.pekerjaan}`,
      c.kepribadian && `Kepribadian: ${c.kepribadian}`,
      c.latar_belakang && `Latar belakang: ${c.latar_belakang}`,
      c.tujuan && `Tujuan: ${c.tujuan}`,
      c.rahasia && `Rahasia: ${c.rahasia}`,
      c.motivasi && `Motivasi: ${c.motivasi}`
    ].filter(Boolean);
    return `TOKOH ${i + 1}\n${fields.map(f => `  • ${f}`).join('\n')}`;
  }).join('\n\n');

  const remaining = Math.max(0, count - characters.length);
  const extra = remaining > 0
    ? `\n\nTambahkan ${remaining} tokoh pendukung orisinal lagi agar total ${count} tokoh, lengkap dengan relasinya terhadap tokoh di atas.`
    : '';

  return `Tokoh yang sudah ditentukan pengguna — WAJIB dipakai persis seperti ini:\n\n${defined}${extra}\n\nBangun relasi antar seluruh tokoh sehingga konflik muncul secara alami dari hubungan mereka.`;
}

function buildSystemPrompt(dna, config) {
  if (!dna.blueprint) {
    throw new Error('Profil DNA ini belum punya Blueprint. Ekstrak ulang novelnya dengan pipeline terbaru.');
  }

  // Nama tokoh dan kutipan dari novel sumber disensor lebih dulu, sehingga
  // prompt penulisan hanya membawa teknik — bukan identitas cerita lama.
  const blueprint = sanitizeBlueprintForGeneration(dna.blueprint);
  const platform = PLATFORMS[config.target_platform] || PLATFORMS.Umum;

  return `Kamu adalah novelis profesional berbahasa Indonesia. Tugasmu menulis novel BARU yang terasa ditulis oleh tangan penulis yang sama dengan novel "${dna.source_title}" — namun dengan cerita yang sepenuhnya orisinal.

${buildOriginalityRules(dna.source_title, config)}

${buildStyleRules(blueprint, config)}

═══ PERMINTAAN PENGGUNA ═══
• Genre yang diminta: ${config.genre}
• Tema cerita: ${config.theme}
• Tingkat emosi: ${EMOTION_LEVELS[config.emotional_level] || EMOTION_LEVELS.medium}
• Kepadatan deskripsi: ${DESCRIPTION_DENSITY[config.description_density] || DESCRIPTION_DENSITY.sedang}
• Target pembaca: ${READING_LEVELS[config.reading_level] || READING_LEVELS.umum}
• Gaya bahasa: ${LANGUAGE_STYLES[config.language_style] || LANGUAGE_STYLES.natural}
• Platform sasaran: ${platform}

CATATAN: Bila genre yang diminta pengguna berbeda dari genre novel sumber, IKUTI genre yang diminta pengguna. Yang diwarisi dari DNA adalah teknik menulisnya, bukan genrenya.

Tulis seluruhnya dalam Bahasa Indonesia yang hidup dan manusiawi.`;
}

// ── Tahap 1: kerangka cerita ────────────────────────────────────────────────

async function generateOutline(dna, config, onChunk, throttle) {
  const client = getAnthropicAuth();
  const system = buildSystemPrompt(dna, config);
  const lengthPreset = STORY_LENGTHS[config.story_length] || STORY_LENGTHS['novel-pendek'];
  const chapterCount = config.chapter_count || lengthPreset.chapters;

  const user = `Susun kerangka lengkap untuk novel baru ini.

JUDUL: ${config.title}
GENRE: ${config.genre}
TEMA: ${config.theme}
JUMLAH BAB: ${chapterCount}
JUMLAH TOKOH UTAMA: ${config.character_count}

${buildCharacterBrief(config.characters, config.character_count)}

Keluarkan kerangka dengan format berikut:

## PREMIS
(2-3 kalimat premis orisinal)

## TOKOH
(untuk tiap tokoh: nama, usia, peran, kepribadian, tujuan, rahasia, konflik batin)

## RELASI ANTAR TOKOH
(bagan hubungan dan sumber gesekan antar mereka)

## BUSUR CERITA
(babak awal, titik tengah, klimaks, resolusi)

## RINCIAN BAB
Untuk SETIAP bab dari 1 sampai ${chapterCount}, tulis dalam format persis:
BAB <nomor> | <judul bab> | <ringkasan 2-3 kalimat> | <beat emosi> | <hook penutup bab>

Pastikan pacing dan eskalasi mengikuti aturan struktur pada DNA.`;

  if (throttle) await throttle();

  const stream = await client.messages.create({
    model: config.model,
    max_tokens: 8000,
    stream: true,
    system,
    messages: [{ role: 'user', content: user }]
  });

  let text = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text += event.delta.text;
      onChunk?.(event.delta.text);
    }
  }
  return text;
}

/**
 * Membaca baris "BAB n | judul | ringkasan | beat | hook" dari kerangka.
 * Bila format tidak terbaca, dibuatkan entri minimal supaya penulisan bab
 * tetap bisa berjalan.
 */
function parseOutlineChapters(outline, expectedCount) {
  const chapters = [];
  const re = /^BAB\s+(\d+)\s*\|\s*(.+)$/gim;

  let m;
  while ((m = re.exec(outline)) !== null) {
    const parts = m[2].split('|').map(s => s.trim());
    chapters.push({
      number: parseInt(m[1], 10),
      title: parts[0] || `Bab ${m[1]}`,
      summary: parts[1] || '',
      emotional_beat: parts[2] || '',
      hook: parts[3] || ''
    });
  }

  const byNumber = new Map(chapters.map(c => [c.number, c]));
  const out = [];
  for (let i = 1; i <= expectedCount; i++) {
    out.push(byNumber.get(i) || {
      number: i,
      title: `Bab ${i}`,
      summary: '',
      emotional_beat: '',
      hook: ''
    });
  }
  return out;
}

// ── Tahap 2: penulisan bab ──────────────────────────────────────────────────

async function writeChapter(dna, config, chapterMeta, context, onChunk, throttle) {
  const client = getAnthropicAuth();
  const system = buildSystemPrompt(dna, config);
  const lengthPreset = STORY_LENGTHS[config.story_length] || STORY_LENGTHS['novel-pendek'];
  const targetWords = config.words_per_chapter || lengthPreset.words_per_chapter;

  const user = `Tulis BAB ${chapterMeta.number} dari ${context.totalChapters} untuk novel "${config.title}".

KERANGKA CERITA LENGKAP (acuan arah cerita):
${context.outline}

${context.prevSummary ? `RINGKASAN BAB SEBELUMNYA:\n${context.prevSummary}\n` : ''}
BAB INI:
• Judul: ${chapterMeta.title}
• Yang harus terjadi: ${chapterMeta.summary || 'kembangkan dari kerangka'}
• Beat emosi: ${chapterMeta.emotional_beat || 'sesuaikan dengan posisi bab'}
• Hook penutup: ${chapterMeta.hook || 'akhiri dengan tegangan yang membuat pembaca lanjut'}

TARGET PANJANG: ~${targetWords} kata

Tulis bab lengkap sekarang. Mulai dengan judul bab pada baris pertama, lalu isi bab.
Terapkan SELURUH aturan gaya, dialog, emosi, dan struktur dari system prompt.
Jangan menulis catatan, komentar, atau penjelasan apa pun di luar isi bab.`;

  if (throttle) await throttle();

  const stream = await client.messages.create({
    model: config.model,
    max_tokens: 8000,
    stream: true,
    system,
    messages: [{ role: 'user', content: user }]
  });

  let content = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      content += event.delta.text;
      onChunk?.(event.delta.text);
    }
  }

  return content;
}

/**
 * Ringkasan bab untuk konteks bab berikutnya.
 * Diambil dari teks bab secara lokal agar tidak memakai panggilan AI tambahan.
 */
function summarizeChapter(content, maxWords = 120) {
  const clean = content.replace(/^#+\s*.+$/gm, '').trim();
  const sentences = clean.match(/[^.!?…]+[.!?…]+/g) || [clean];
  // Ambil dari awal dan akhir bab: keduanya paling menentukan kesinambungan.
  const head = sentences.slice(0, 4).join(' ');
  const tail = sentences.slice(-3).join(' ');
  return `${head} […] ${tail}`.split(/\s+/).slice(0, maxWords).join(' ');
}

// ── Pemeriksaan orisinalitas ────────────────────────────────────────────────

/**
 * Mendeteksi kemiripan harfiah dengan novel sumber menggunakan n-gram.
 * Ini jaring pengaman terukur untuk aturan anti-plagiat pada PRD —
 * tidak bergantung pada janji model.
 */
function checkOriginality(generatedText, sourceText, n = 8) {
  if (!sourceText || !sourceText.trim()) {
    return { checked: false, reason: 'Teks novel sumber tidak tersedia untuk dibandingkan' };
  }

  const normalize = t => t.toLowerCase().replace(/[^a-zà-ɏ\s]/g, ' ').split(/\s+/).filter(Boolean);

  const src = normalize(sourceText);
  const gen = normalize(generatedText);

  const srcGrams = new Set();
  for (let i = 0; i + n <= src.length; i++) {
    srcGrams.add(src.slice(i, i + n).join(' '));
  }

  const matches = [];
  let genGramCount = 0;
  for (let i = 0; i + n <= gen.length; i++) {
    genGramCount++;
    const g = gen.slice(i, i + n).join(' ');
    if (srcGrams.has(g)) matches.push(g);
  }

  const overlapPct = genGramCount ? (matches.length / genGramCount) * 100 : 0;

  return {
    checked: true,
    ngram_size: n,
    overlap_pct: Math.round(overlapPct * 100) / 100,
    match_count: matches.length,
    // Beberapa contoh untuk ditinjau manual bila ada temuan.
    samples: [...new Set(matches)].slice(0, 5),
    // Ambang longgar: tumpang tindih 8-kata di bawah 0,5% wajar terjadi
    // pada frasa umum berbahasa Indonesia.
    passed: overlapPct < 0.5
  };
}

// ── Orkestrator ─────────────────────────────────────────────────────────────

/**
 * Melengkapi konfigurasi dari form dengan nilai bawaan yang aman.
 */
function normalizeConfig(raw, dna) {
  const lengthPreset = STORY_LENGTHS[raw.story_length] || STORY_LENGTHS['novel-pendek'];
  const bp = dna.blueprint || {};

  return {
    title: val(raw.title, 'Novel Tanpa Judul'),
    genre: val(raw.genre, bp.genre_formula?.primary_genre || 'Romance'),
    theme: val(raw.theme, 'konflik keluarga dan pilihan hidup'),
    characters: Array.isArray(raw.characters) ? raw.characters : [],
    character_count: parseInt(raw.character_count) || 3,
    pov: val(raw.pov, 'auto'),
    story_length: val(raw.story_length, 'novel-pendek'),
    chapter_count: parseInt(raw.chapter_count) || lengthPreset.chapters,
    words_per_chapter: parseInt(raw.words_per_chapter) || lengthPreset.words_per_chapter,
    style_strength: parseInt(raw.style_strength) || 75,
    emotional_level: val(raw.emotional_level, 'medium'),
    dialogue_density: val(raw.dialogue_density, 'normal'),
    description_density: val(raw.description_density, 'sedang'),
    reading_level: val(raw.reading_level, 'umum'),
    language_style: val(raw.language_style, 'natural'),
    target_platform: val(raw.target_platform, 'Umum'),
    allow_original_names: raw.allow_original_names === true,
    model: val(raw.model, DEFAULT_MODEL)
  };
}

/**
 * Menjalankan seluruh proses pembuatan novel baru dari DNA.
 * onEvent dipanggil untuk setiap tahap agar UI bisa menampilkan kemajuan.
 */
async function generateNovelFromDNA(dna, rawConfig, onEvent) {
  const config = normalizeConfig(rawConfig, dna);
  const throttle = createRateLimiter();
  const emit = (type, data) => { try { onEvent?.(type, data); } catch (_) {} };

  if (!dna.blueprint) {
    throw new Error('Profil DNA ini dibuat dengan versi lama dan belum memiliki Blueprint. Ekstrak ulang novel sumbernya terlebih dahulu.');
  }

  // ── Kerangka ──
  emit('outline_start', { message: 'Menyusun kerangka cerita orisinal…', config });
  let outline = '';
  await generateOutline(dna, config, chunk => {
    outline += chunk;
    emit('stream', { phase: 'outline', text: chunk });
  }, throttle);
  emit('outline_done', { outline });

  const chapterPlan = parseOutlineChapters(outline, config.chapter_count);
  emit('chapters_planned', { total: chapterPlan.length, chapters: chapterPlan.map(c => ({ number: c.number, title: c.title })) });

  // ── Bab demi bab ──
  const chapters = [];
  let prevSummary = '';

  for (const meta of chapterPlan) {
    emit('chapter_start', { chapter: meta.number, total: chapterPlan.length, title: meta.title });

    let content = '';
    try {
      content = await writeChapter(
        dna,
        config,
        meta,
        { outline, prevSummary, totalChapters: chapterPlan.length },
        chunk => emit('stream', { phase: 'chapter', chapter: meta.number, text: chunk }),
        throttle
      );
    } catch (err) {
      emit('chapter_failed', { chapter: meta.number, error: err.message });
      continue;
    }

    prevSummary = summarizeChapter(content);
    chapters.push({
      number: meta.number,
      title: meta.title,
      content,
      word_count: content.split(/\s+/).filter(Boolean).length
    });
    emit('chapter_done', {
      chapter: meta.number,
      total: chapterPlan.length,
      word_count: chapters[chapters.length - 1].word_count
    });
  }

  if (chapters.length === 0) {
    throw new Error('Tidak ada bab yang berhasil ditulis — periksa koneksi atau ganti model AI');
  }

  // ── Pemeriksaan orisinalitas ──
  emit('originality_check', { message: 'Memeriksa orisinalitas terhadap novel sumber…' });
  const fullText = chapters.map(c => c.content).join('\n\n');
  let originality = { checked: false };
  try {
    const { getDNASourceText } = require('./dnaExtractor');
    const sourceText = await getDNASourceText(dna.dna_id);
    originality = sourceText
      ? checkOriginality(fullText, sourceText)
      : {
          checked: false,
          reason: 'Profil DNA ini tidak menyimpan naskah sumber (hasil ekstraksi versi lama). Ekstrak ulang agar pemeriksaan orisinalitas bisa dijalankan.'
        };
  } catch (err) {
    originality = { checked: false, reason: err.message };
  }
  emit('originality_result', originality);

  const totalWords = chapters.reduce((a, c) => a + c.word_count, 0);

  emit('complete', {
    message: 'Novel baru selesai ditulis',
    chapter_count: chapters.length,
    total_words: totalWords,
    originality
  });

  return {
    title: config.title,
    genre: config.genre,
    theme: config.theme,
    outline,
    chapters,
    total_words: totalWords,
    originality,
    config,
    dna_id: dna.dna_id,
    source_title: dna.source_title
  };
}

module.exports = {
  generateNovelFromDNA,
  buildSystemPrompt,
  sanitizeBlueprintForGeneration,
  collectSourceNames,
  redactNames,
  redactSourcePhrases,
  buildStyleRules,
  buildOriginalityRules,
  buildCharacterBrief,
  parseOutlineChapters,
  summarizeChapter,
  checkOriginality,
  normalizeConfig,
  GENRES,
  POV_OPTIONS,
  STORY_LENGTHS,
  STYLE_STRENGTH,
  EMOTION_LEVELS,
  DIALOGUE_DENSITY,
  DESCRIPTION_DENSITY,
  READING_LEVELS,
  LANGUAGE_STYLES,
  PLATFORMS
};
