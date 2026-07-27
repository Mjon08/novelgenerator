/*
 * PREPROCESSOR — Step 2 pipeline DNA
 *
 * Membersihkan naskah mentah hasil parsing file sebelum dianalisis:
 *   normalisasi teks → buang watermark → buang nomor halaman →
 *   buang halaman kosong → deteksi bab → deteksi adegan →
 *   klasifikasi dialog vs narasi
 *
 * Semua dikerjakan secara lokal tanpa memanggil AI, sehingga tidak
 * memakan kuota dan hasilnya deterministik.
 */

// ── Normalisasi teks ────────────────────────────────────────────────────────

function normalizeText(raw) {
  let t = String(raw || '');

  // Samakan line ending dan buang BOM.
  t = t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  // Samakan tanda kutip tipografis ke bentuk lurus supaya deteksi dialog
  // tidak meleset karena variasi karakter kutip.
  t = t.replace(/[“”„‟]/g, '"')
       .replace(/[‘’‚‛]/g, "'");

  // Samakan macam-macam tanda pisah ke em dash.
  t = t.replace(/[–—―]/g, '—');

  // Buang karakter kontrol tak terlihat (zero-width, soft hyphen).
  t = t.replace(/[​-‍­﻿]/g, '');

  // Rapatkan spasi horizontal berlebih, tanpa menyentuh baris baru.
  t = t.replace(/[ \t ]+/g, ' ');

  // Buang spasi di ujung tiap baris.
  t = t.split('\n').map(l => l.trimEnd()).join('\n');

  // Maksimal dua baris kosong berturut-turut (penanda jeda adegan tetap utuh).
  t = t.replace(/\n{4,}/g, '\n\n\n');

  return t.trim();
}

// ── Buang watermark & artefak konversi ──────────────────────────────────────

// Pola baris yang lazim muncul dari hasil bajakan / konversi PDF dan
// tidak merupakan bagian dari naskah.
const WATERMARK_PATTERNS = [
  /^\s*(?:di)?(?:download|unduh|baca)\s+(?:gratis|selengkapnya|novel)/i,
  /^\s*(?:www\.|https?:\/\/)\S+\s*$/i,
  /^\s*\S+\.(?:com|net|org|id|co\.id|xyz|info)\s*$/i,
  /^\s*(?:telegram|whatsapp|instagram|facebook|tiktok)\s*[:@]/i,
  /^\s*(?:penerbit|publisher|copyright|hak cipta|all rights reserved)\b/i,
  /^\s*(?:scan|scanned|convert(?:ed)?|ebook|e-book)\s+by\b/i,
  /^\s*-{2,}\s*(?:iklan|advertisement|promo)\s*-{2,}\s*$/i,
  /novel\s*(?:gratis|online)\s*(?:terbaru|terlengkap)/i
];

function isWatermarkLine(line) {
  const l = line.trim();
  if (!l) return false;
  // Baris panjang hampir pasti bagian naskah, jangan dibuang walau cocok pola.
  if (l.split(/\s+/).length > 12) return false;
  return WATERMARK_PATTERNS.some(re => re.test(l));
}

// ── Buang nomor halaman ─────────────────────────────────────────────────────

function isPageNumberLine(line) {
  const l = line.trim();
  if (!l) return false;

  // Angka berdiri sendiri: "12"
  if (/^\d{1,4}$/.test(l)) return true;

  // "Halaman 12", "Hal. 12", "Page 12"
  if (/^(?:halaman|hal\.?|page|pg\.?)\s*\d{1,4}$/i.test(l)) return true;

  // "12 | Judul Novel" atau "Judul Novel | 12"
  if (/^\d{1,4}\s*[|│]\s*.{1,50}$/.test(l)) return true;
  if (/^.{1,50}\s*[|│]\s*\d{1,4}$/.test(l)) return true;

  // "- 12 -" atau "~ 12 ~"
  if (/^[-~—*]{1,3}\s*\d{1,4}\s*[-~—*]{1,3}$/.test(l)) return true;

  return false;
}

/**
 * Membuang watermark, nomor halaman, dan halaman kosong.
 * Mengembalikan teks bersih beserta laporan apa saja yang dibuang.
 */
function stripArtifacts(text) {
  const lines = text.split('\n');
  const kept = [];
  const report = { watermark: 0, page_numbers: 0, blank_runs: 0 };

  let blankRun = 0;

  for (const line of lines) {
    if (isWatermarkLine(line)) { report.watermark++; continue; }
    if (isPageNumberLine(line)) { report.page_numbers++; continue; }

    if (!line.trim()) {
      blankRun++;
      // Lebih dari dua baris kosong beruntun = sisa halaman kosong.
      if (blankRun > 2) { report.blank_runs++; continue; }
      kept.push('');
      continue;
    }

    blankRun = 0;
    kept.push(line);
  }

  return { text: kept.join('\n').trim(), report };
}

// ── Deteksi bab ─────────────────────────────────────────────────────────────

// Pola judul bab yang umum di naskah Indonesia dan Inggris.
const CHAPTER_PATTERNS = [
  /^\s*bab\s+(?:ke-?\s*)?(\d+|[ivxlcdm]+|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|dua\s*belas)\b.*$/i,
  /^\s*chapter\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b.*$/i,
  /^\s*(?:part|bagian|jilid|episode|eps\.?)\s+(\d+|[ivxlcdm]+)\b.*$/i,
  /^\s*#{1,3}\s+.+$/,                       // heading markdown
  /^\s*\d{1,3}\s*[.——:]\s*\S.{0,80}$/  // "1. Pertemuan" / "12 — Pulang"
];

function isChapterHeading(line) {
  const l = line.trim();
  if (!l) return false;
  // Judul bab selalu pendek; kalimat panjang bukan judul.
  if (l.split(/\s+/).length > 14) return false;
  return CHAPTER_PATTERNS.some(re => re.test(l));
}

/**
 * Memecah naskah menjadi daftar bab.
 * Jika tidak ada penanda bab yang terdeteksi, seluruh naskah dianggap satu bab
 * sehingga pipeline di tahap berikutnya tetap bisa berjalan.
 */
function detectChapters(text) {
  const lines = text.split('\n');
  const chapters = [];
  let current = null;

  for (const line of lines) {
    if (isChapterHeading(line)) {
      if (current) chapters.push(current);
      current = { title: line.trim(), lines: [] };
      continue;
    }
    if (!current) current = { title: null, lines: [] };
    current.lines.push(line);
  }
  if (current) chapters.push(current);

  const built = chapters
    .map((c, i) => {
      const content = c.lines.join('\n').trim();
      return {
        number: i + 1,
        title: c.title || `Bab ${i + 1}`,
        // Bedakan judul asli dari judul buatan, berguna saat menganalisis
        // gaya penamaan bab penulis.
        title_detected: Boolean(c.title),
        content,
        word_count: content ? content.split(/\s+/).filter(Boolean).length : 0
      };
    })
    .filter(c => c.word_count >= 50); // buang sisa daftar isi / halaman judul

  if (built.length === 0) {
    const content = text.trim();
    return [{
      number: 1,
      title: 'Naskah Utuh',
      title_detected: false,
      content,
      word_count: content.split(/\s+/).filter(Boolean).length
    }];
  }

  // Nomori ulang setelah penyaringan agar berurutan rapi.
  return built.map((c, i) => ({ ...c, number: i + 1 }));
}

// ── Deteksi adegan ──────────────────────────────────────────────────────────

// Penanda jeda adegan yang lazim: "***", "---", "###", "◆", dst.
const SCENE_BREAK = /^\s*(?:[*\-–—=~#◆●○•·]{3,}|\*\s*\*\s*\*|#{1,3}\s*$)\s*$/;

/**
 * Memecah isi bab menjadi adegan.
 * Prioritas: penanda jeda eksplisit. Jika tidak ada, bab dipotong per
 * kumpulan paragraf agar unit analisis tidak terlalu besar.
 */
function detectScenes(chapterContent, targetWordsPerScene = 900) {
  const lines = chapterContent.split('\n');
  const explicit = [];
  let buf = [];

  for (const line of lines) {
    if (SCENE_BREAK.test(line)) {
      if (buf.join('\n').trim()) explicit.push(buf.join('\n').trim());
      buf = [];
      continue;
    }
    buf.push(line);
  }
  if (buf.join('\n').trim()) explicit.push(buf.join('\n').trim());

  let scenes = explicit.filter(s => s.split(/\s+/).filter(Boolean).length >= 30);

  // Tidak ada penanda eksplisit → potong berdasarkan batas paragraf.
  if (scenes.length <= 1) {
    const paragraphs = chapterContent.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    scenes = [];
    let acc = [];
    let accWords = 0;

    for (const p of paragraphs) {
      const w = p.split(/\s+/).filter(Boolean).length;
      acc.push(p);
      accWords += w;
      if (accWords >= targetWordsPerScene) {
        scenes.push(acc.join('\n\n'));
        acc = [];
        accWords = 0;
      }
    }
    // Sisa paragraf: gabung ke adegan terakhir bila terlalu pendek untuk berdiri sendiri.
    if (acc.length) {
      const tail = acc.join('\n\n');
      if (scenes.length && tail.split(/\s+/).filter(Boolean).length < 150) {
        scenes[scenes.length - 1] += '\n\n' + tail;
      } else {
        scenes.push(tail);
      }
    }
  }

  if (scenes.length === 0 && chapterContent.trim()) scenes = [chapterContent.trim()];

  return scenes.map((content, i) => ({
    number: i + 1,
    content,
    word_count: content.split(/\s+/).filter(Boolean).length,
    ...classifyProse(content)
  }));
}

// ── Klasifikasi dialog vs narasi ────────────────────────────────────────────

/**
 * Sebuah baris dianggap dialog bila diapit tanda kutip atau diawali tanda
 * pisah percakapan.
 */
function isDialogueLine(line) {
  const l = line.trim();
  if (!l) return false;
  if (/^["'].*/.test(l)) return true;
  if (/^—\s*\S/.test(l)) return true;
  // Kutipan di tengah baris yang mendominasi isi baris.
  const quoted = l.match(/"[^"]{3,}"/g);
  if (quoted) {
    const quotedLen = quoted.join('').length;
    if (quotedLen / l.length > 0.4) return true;
  }
  return false;
}

/**
 * Mengambil setiap petikan dialog dari teks.
 * Dihitung per-petikan, bukan per-baris, karena banyak novel menaruh dialog
 * menempel di tengah paragraf narasi ("Kau yakin?" tanya Rani). Kalau
 * dihitung per-baris, dialog semacam itu hilang seluruhnya dari statistik.
 */
function extractDialogueSpans(text) {
  const spans = [];

  // Petikan dalam tanda kutip.
  for (const m of text.matchAll(/"([^"\n]{2,})"/g)) {
    spans.push(m[1].trim());
  }

  // Gaya tanda pisah: baris diawali em dash.
  for (const line of text.split('\n')) {
    const l = line.trim();
    const dash = l.match(/^—\s*(.+)$/);
    if (dash) spans.push(dash[1].trim());
  }

  return spans.filter(Boolean);
}

/**
 * Menghitung komposisi dialog / narasi dalam sepotong teks dan
 * mengumpulkan statistik dialog yang dipakai analisis DNA.
 *
 * Rasio dihitung berbasis kata di dalam petikan, sehingga akurat baik untuk
 * dialog yang berdiri sendiri maupun yang menempel di paragraf narasi.
 */
function classifyProse(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const totalWords = text.split(/\s+/).filter(Boolean).length;

  const spans = extractDialogueSpans(text);
  const dialogueWords = spans.join(' ').split(/\s+/).filter(Boolean).length;
  const narrationWords = Math.max(0, totalWords - dialogueWords);

  const spanLengths = spans.map(s => s.split(/\s+/).filter(Boolean).length);
  const avgDialogueLength = spanLengths.length
    ? Math.round(spanLengths.reduce((a, b) => a + b, 0) / spanLengths.length)
    : 0;

  // Baris yang didominasi dialog — dipakai menilai ritme bolak-balik percakapan.
  const dialogueLineCount = lines.filter(isDialogueLine).length;

  return {
    dialogue_span_count: spans.length,
    dialogue_line_count: dialogueLineCount,
    narration_line_count: lines.length - dialogueLineCount,
    dialogue_ratio: totalWords ? Math.round((dialogueWords / totalWords) * 100) : 0,
    narration_ratio: totalWords ? Math.round((narrationWords / totalWords) * 100) : 0,
    avg_dialogue_length: avgDialogueLength
  };
}

// ── Metrik gaya terukur ─────────────────────────────────────────────────────

/**
 * Statistik yang bisa dihitung pasti tanpa AI. Angka-angka ini dikirim
 * bersama prompt agar AI tidak perlu menebak-nebak hal yang bisa diukur,
 * dan agar hasil DNA tidak berubah-ubah antar ekstraksi.
 */
function computeMetrics(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.match(/[^.!?…]+[.!?…]+/g) || [];
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  const sentenceLengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const avgSentence = sentenceLengths.length
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;

  // Simpangan baku panjang kalimat = ukuran variasi ritme.
  const variance = sentenceLengths.length
    ? sentenceLengths.reduce((a, l) => a + Math.pow(l - avgSentence, 2), 0) / sentenceLengths.length
    : 0;

  const paragraphLengths = paragraphs.map(p => (p.match(/[^.!?…]+[.!?…]+/g) || [p]).length);
  const avgParagraph = paragraphLengths.length
    ? paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length
    : 0;

  // Kekayaan kosakata: rasio kata unik terhadap total (type-token ratio).
  const normalized = words.map(w => w.toLowerCase().replace(/[^a-zÀ-ɏ']/g, '')).filter(Boolean);
  const unique = new Set(normalized);
  const vocabRichness = normalized.length
    ? Math.round((unique.size / normalized.length) * 1000) / 10
    : 0;

  return {
    word_count: words.length,
    sentence_count: sentences.length,
    paragraph_count: paragraphs.length,
    avg_sentence_length: Math.round(avgSentence * 10) / 10,
    sentence_length_stddev: Math.round(Math.sqrt(variance) * 10) / 10,
    avg_paragraph_sentences: Math.round(avgParagraph * 10) / 10,
    vocabulary_richness_pct: vocabRichness,
    unique_word_count: unique.size,
    ...classifyProse(text)
  };
}

/**
 * Kata dan frasa yang paling sering dipakai penulis, di luar kata umum.
 * Ini bahan mentah untuk "Language Fingerprint" di PRD.
 */
const STOPWORDS = new Set([
  'yang','dan','di','ke','dari','itu','ini','dengan','untuk','pada','adalah','tidak','akan',
  'dalam','sudah','saya','aku','kamu','dia','mereka','kami','kita','ada','juga','bisa','saja',
  'karena','oleh','tapi','tetapi','atau','bila','jika','agar','sebagai','seperti','lebih','masih',
  'para','sang','si','nya','pun','lah','kah','the','a','an','of','to','in','is','was','and','it'
]);

function extractFrequentTerms(text, topN = 30) {
  const words = text.toLowerCase()
    .replace(/[^a-zÀ-ɏ\s']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w));

  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);

  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));

  // Frasa dua kata yang berulang — penanda gaya yang lebih kuat dari kata tunggal.
  const bigrams = new Map();
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]} ${words[i + 1]}`;
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }
  const topPhrases = [...bigrams.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([phrase, count]) => ({ phrase, count }));

  return { top_words: topWords, top_phrases: topPhrases };
}

// ── Pipeline preprocessing utuh ─────────────────────────────────────────────

/**
 * Menjalankan seluruh Step 2 PRD dan mengembalikan struktur naskah
 * yang siap dipotong secara semantik.
 */
function preprocess(rawText) {
  const normalized = normalizeText(rawText);
  const { text: cleaned, report } = stripArtifacts(normalized);

  const chapters = detectChapters(cleaned).map(ch => ({
    ...ch,
    scenes: detectScenes(ch.content),
    metrics: computeMetrics(ch.content)
  }));

  const metrics = computeMetrics(cleaned);
  const fingerprint = extractFrequentTerms(cleaned);

  return {
    text: cleaned,
    chapters,
    metrics,
    fingerprint,
    cleanup_report: report,
    stats: {
      chapter_count: chapters.length,
      scene_count: chapters.reduce((a, c) => a + c.scenes.length, 0),
      // Judul bab asli vs buatan — dipakai menilai gaya penamaan bab.
      chapters_with_detected_titles: chapters.filter(c => c.title_detected).length,
      avg_chapter_words: chapters.length
        ? Math.round(chapters.reduce((a, c) => a + c.word_count, 0) / chapters.length)
        : 0
    }
  };
}

module.exports = {
  normalizeText,
  stripArtifacts,
  detectChapters,
  detectScenes,
  classifyProse,
  extractDialogueSpans,
  isDialogueLine,
  isChapterHeading,
  computeMetrics,
  extractFrequentTerms,
  preprocess
};
