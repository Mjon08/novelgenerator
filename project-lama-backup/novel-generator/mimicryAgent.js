/*
 * MIMICRY AGENT
 * Given a NovelDNA object, builds a deep system prompt and generates
 * outline + chapters that feel written by the same human author.
 *
 * Uses claude-opus-4-8 with adaptive thinking for generation (same as main generator).
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getAnthropicAuth } = require('./auth');

const client = new Anthropic(getAnthropicAuth());

// ── Helper: join array or return fallback ──────────────────────────────────
function arr(v, sep = ', ', fallback = 'natural') {
  if (Array.isArray(v) && v.length) return v.join(sep);
  if (typeof v === 'string' && v) return v;
  return fallback;
}
function val(v, fallback = '') {
  return v !== undefined && v !== null && v !== '' ? String(v) : fallback;
}

// ── Phase 3A: Build Mimicry System Prompt ─────────────────────────────────
function buildMimicrySystemPrompt(dna, userRequest) {
  const L = dna.language || {};
  const S = dna.style || {};
  const St = dna.structure || {};
  const C = dna.character || {};
  const H = dna.human_touch || {};
  const T = dna.thematic || {};

  const sampleSentences = Array.isArray(S.sample_sentences) && S.sample_sentences.length
    ? S.sample_sentences.map((s, i) => `  ${i + 1}. "${s}"`).join('\n')
    : '  (no samples extracted)';

  const signaturePhrases = Array.isArray(S.signature_phrases) && S.signature_phrases.length
    ? S.signature_phrases.map((p, i) => `  ${i + 1}. ${p}`).join('\n')
    : '  (no patterns extracted)';

  return `Tugasmu adalah menulis novel ORISINAL yang autentik meniru suara penulisan pengarang "${val(dna.source_title, 'novel referensi')}". Pelajari setiap aturan di bawah dan terapkan secara konsisten sepanjang tulisanmu.

═══════════════════════════════════════════════════════
BAGIAN 1 — ATURAN BAHASA
═══════════════════════════════════════════════════════
• Tingkat kosakata: ${val(L.vocabulary_level, 'natural')}
• Bahasa / register dominan: ${val(L.dominant_language, 'Bahasa Indonesia')}
• Rata-rata panjang kalimat: ~${val(L.sentence_avg_length, 15)} kata per kalimat
• Gaya tanda baca: ${val(L.punctuation_style, 'standar')}
• Rata-rata panjang paragraf: ~${val(L.paragraph_avg_length, 4)} kalimat per paragraf
• Kata-kata khas yang diselipkan secara natural: ${arr(L.special_words)}
• Ekspresi gaul/dialek yang digunakan hemat: ${arr(L.slang_or_dialect, ', ', 'tidak ada')}
• Pola penggunaan kata asing: ${val(L.foreign_words_usage, 'tidak ada')}

═══════════════════════════════════════════════════════
BAGIAN 2 — ATURAN GAYA
═══════════════════════════════════════════════════════
• Sudut pandang: ${val(S.pov, 'orang-ketiga-terbatas')}
• Kala: ${val(S.tense, 'lampau')}
• Nada suara naratif: ${val(S.narrative_voice_tone, 'netral')}
• Ritme kalimat: ${val(S.sentence_rhythm, 'bervariasi')}
• Kepadatan deskripsi: ${val(S.description_density, 'sedang')}
• Persentase dialog: ~${val(S.dialogue_ratio, 30)}% teks harus berupa dialog
• Gaya monolog batin: ${val(S.internal_monologue_style, 'terintegrasi')}
• Frekuensi metafora: ${val(S.metaphor_frequency, 'kadang')}

POLA KALIMAT KHAS PENGARANG — tiru ritmenya (jangan menyalin):
${signaturePhrases}

KALIMAT ASLI DARI NOVEL SUMBER — gunakan sebagai jangkar gaya (JANGAN menyalin kata per kata):
${sampleSentences}

═══════════════════════════════════════════════════════
BAGIAN 3 — ATURAN STRUKTUR
═══════════════════════════════════════════════════════
• Target panjang bab: ~${val(St.avg_chapter_length_words, 2500)} kata per bab
• Gaya pembuka bab: ${val(St.chapter_opening_style, 'langsung di tengah aksi')}
• Gaya penutup bab: ${val(St.chapter_closing_style, 'ketegangan tak terpecahkan')}
• Struktur plot keseluruhan: ${val(St.plot_structure, 'linear')}
• Struktur babak: ${val(St.act_structure, '3 babak')}
• Pola pacing: ${val(St.pacing_pattern, 'lambat membangun, klimaks meledak')}
• Gunakan kilas balik: ${St.flashback_usage ? 'ya — integrasikan secara natural' : 'tidak'}
• Gaya judul bab: ${val(St.chapter_title_style, 'angka saja')}

═══════════════════════════════════════════════════════
BAGIAN 4 — ATURAN SUARA KARAKTER
═══════════════════════════════════════════════════════
• Protagonis berbicara/berpikir: ${val(C.protagonist_voice, 'introspektif dan berjaga-jaga')}
• Gaya dialog: ${val(C.dialogue_style, 'natural, penuh subteks')}
• Pola pengenalan karakter: ${val(C.character_intro_pattern, 'tunjukkan sebelum ceritakan')}
• Dinamika hubungan: ${val(C.relationship_dynamics, 'kompleks, berkembang')}
• Emosi diekspresikan melalui: ${val(C.emotional_expression_style, 'tindakan dan implikasi')}
• Gaya nama karakter: ${val(C.character_names_style, 'nama depan realistis')}

═══════════════════════════════════════════════════════
BAGIAN 5 — ATURAN SENTUHAN MANUSIA
═══════════════════════════════════════════════════════
• Ekspresi pengisi yang diselipkan secara natural: ${arr(H.filler_expressions, ', ', 'tidak ada')}
• Biarkan emosi meresap ke narasi: ${val(H.emotional_leakage, 'melalui pergeseran pilihan kata')}
• Ketidaksempurnaan disengaja untuk efek: ${arr(H.imperfection_markers, '; ', 'fragmen sesekali')}
• Gaya humor: ${val(H.humor_style, 'jarang dan kering')}
• Teknik membangun ketegangan: ${val(H.tension_build_technique, 'akumulasi lambat')}
• Preferensi indrawi: ${val(H.sensory_preference, 'seimbang')}
• Ritme pernapasan paragraf: ${val(H.breathing_rhythm, 'bervariasi sesuai intensitas adegan')}

═══════════════════════════════════════════════════════
BAGIAN 6 — ATURAN TEMATIK
═══════════════════════════════════════════════════════
• Tema inti yang dieksplorasi: ${arr(T.core_themes)}
• Tingkat ambiguitas moral: ${val(T.moral_ambiguity_level, 'abu-abu')}
• Perpaduan genre: ${arr(T.genre_blend)}
• Pendekatan world-building: ${val(T.world_building_style, 'membumi dan spesifik')}
• Kecenderungan akhir cerita: ${val(T.ending_tendency, 'pahit-manis')}

═══════════════════════════════════════════════════════
INSTRUKSI AKHIR
═══════════════════════════════════════════════════════
Kamu menulis novel SEPENUHNYA ORISINAL dengan plot baru, karakter baru, dan judul baru. Cerita harus sepenuhnya ciptaanmu sendiri — bukan penceritaan ulang atau sekuel dari "${val(dna.source_title, 'aslinya')}".

Namun, SETIAP kualitas stilistik, struktural, linguistik, dan sentuhan manusia dalam tulisanmu harus terasa seolah-olah pengarang manusia yang sama yang menulis "${val(dna.source_title, 'aslinya')}" menulis novel baru ini.

ATURAN KERAS:
1. JANGAN menyalin kalimat, nama, hubungan karakter, atau poin plot apa pun dari aslinya.
2. Tulis sebagai manusia, bukan AI — gunakan aturan sentuhan manusia di atas.
3. Pertahankan suara dan semua aturan gaya sepanjang setiap bab.
4. Pembaca harus merasa sedang membaca karya baru dari pengarang yang sama.`;
}

// ── Phase 3B: Generate Mimicry Outline ────────────────────────────────────
async function generateMimicryOutline(dna, { title, genre, chapters, theme_hint, language_override }, onChunk) {
  const systemPrompt = buildMimicrySystemPrompt(dna);
  const St = dna.structure || {};
  const targetChapters = chapters || St.total_chapters || 10;

  const userMsg = `Buat kerangka ${targetChapters} bab untuk novel orisinal baru.

Judul: "${title}"
Genre: ${genre}
${theme_hint ? `Petunjuk tema: ${theme_hint}` : ''}
${language_override ? `Tulis dalam: ${language_override} (pertahankan semua DNA stilistik namun dalam bahasa ini)` : ''}

Struktur kerangka harus:
- Mencerminkan pola pacing ini: ${val(St.pacing_pattern, 'lambat membangun, klimaks menegangkan')}
- Mengikuti struktur babak: ${val(St.act_structure, '3 babak')}
- Membuka bab dengan: ${val(St.chapter_opening_style, 'langsung di tengah aksi')}
- Menutup bab dengan: ${val(St.chapter_closing_style, 'ketegangan tak terpecahkan')}

Kembalikan kerangka detail berisi:
1. 3-5 karakter utama (dengan suara yang sesuai aturan DNA karakter di atas)
2. Rincian per bab (judul, ringkasan, peristiwa kunci, beat emosional)
3. Busur cerita keseluruhan
4. Konflik inti dan kecenderungan resolusi

Format dengan jelas menggunakan header.`;

  const stream = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    stream: true,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }]
  });

  let outlineText = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      outlineText += event.delta.text;
      onChunk?.(event.delta.text);
    }
  }
  return outlineText;
}

// ── Phase 3C: Write Mimicry Chapter ───────────────────────────────────────
async function writeMimicryChapter(dna, chapterMeta, prevSummary, chapterNum, totalChapters, onChunk) {
  const systemPrompt = buildMimicrySystemPrompt(dna);
  const St = dna.structure || {};
  const targetWords = St.avg_chapter_length_words || 2500;

  const userMsg = `Kamu sedang menulis Bab ${chapterNum} dari ${totalChapters} novel "${chapterMeta.novelTitle || 'Tanpa Judul'}".

${prevSummary ? `RINGKASAN BAB SEBELUMNYA:\n${prevSummary}\n` : ''}
KERANGKA LENGKAP UNTUK KONTEKS:\n${chapterMeta.outline || '(lihat tujuan bab di bawah)'}

TUJUAN BAB ${chapterNum}:
${chapterMeta.summary || chapterMeta.title || `Bab ${chapterNum}`}

PERISTIWA KUNCI YANG HARUS DIMASUKKAN:
${chapterMeta.key_events || chapterMeta.summary || '(kembangkan secara organik dari kerangka)'}

GAYA JUDUL BAB: ${val(St.chapter_title_style, 'gunakan judul bab yang sesuai')}

TARGET PANJANG: ~${targetWords} kata

Terapkan SEMUA aturan gaya, bahasa, dan sentuhan manusia dari system prompt di sepanjang bab ini. Mulai menulis bab sekarang — sertakan judul bab terlebih dahulu, kemudian teks bab lengkap.`;

  const stream = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 8192,
    thinking: { type: 'adaptive' },
    stream: true,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }]
  });

  let chapterContent = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      chapterContent += event.delta.text;
      onChunk?.(event.delta.text);
    }
  }

  // Generate a summary for the next chapter's context
  const summary = chapterContent.split(/\s+/).slice(0, 100).join(' ') + '…';

  return { content: chapterContent, summary };
}

module.exports = { buildMimicrySystemPrompt, generateMimicryOutline, writeMimicryChapter };
