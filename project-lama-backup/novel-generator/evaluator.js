/*
 * EVALUATION SCORING RUBRIC
 *
 * STYLE MATCH (30% weight):
 *   90-100: Writing style is indistinguishable from reference novels
 *   70-89:  Clear influence, minor deviations in rhythm or vocabulary
 *   50-69:  Partially matches, noticeable style inconsistencies
 *   <50:    Style is generic, little connection to reference material
 *
 * NARRATIVE QUALITY (50% weight):
 *   90-100: Professional level, no plot holes, characters feel real
 *   70-89:  Solid storytelling, minor pacing issues
 *   50-69:  Readable but has structural weaknesses
 *   <50:    Significant issues with coherence or character consistency
 *
 * ORIGINALITY (20% weight):
 *   90-100: Fully original prose, only thematic/stylistic inspiration
 *   70-89:  Influenced but no direct copying
 *   50-69:  Some phrases too close to source material
 *   <50:    Likely copied sentences detected
 *
 * GRADE MAPPING:
 *   90-100 = A  (excellent)
 *   75-89  = B  (good)
 *   60-74  = C  (needs_improvement)
 *   45-59  = D  (poor)
 *   <45    = F  (regenerate)
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase, throwIfError } = require('./database/supabaseClient');
const { getAnthropicAuth } = require('./auth');

const client = new Anthropic(getAnthropicAuth());
const MODEL = 'claude-sonnet-4-6';

function parseJSON(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in evaluator response');
  return JSON.parse(match[0]);
}

async function callEvaluator(prompt) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }]
  });
  return parseJSON(msg.content[0].text);
}

// ── Phase 1A: Style Evaluator ──────────────────────────────────────────────
async function evaluateStyle(novelText, styleProfiles) {
  if (!styleProfiles || styleProfiles.length === 0) {
    return {
      score: 75, vocabulary_match: 75, sentence_rhythm_match: 75,
      tone_match: 75, pov_consistency: 75,
      feedback: 'No reference style profiles available — baseline score assigned.',
      skipped: true
    };
  }

  const excerpt = novelText.split(/\s+/).slice(0, 2000).join(' ');
  const profileSummary = styleProfiles.slice(0, 2).map(p =>
    `Novel "${p.title}": writing_style="${p.writing_style}", sentence_rhythm="${p.sentence_rhythm}", tone="${p.tone}", pov="${p.pov}", sample="${(p.sample_paragraph || '').slice(0, 200)}"`
  ).join('\n');

  const prompt = `Kamu adalah kritikus sastra. Bandingkan kutipan novel ini dengan profil gaya di bawah.
Berikan skor 0-100 untuk setiap dimensi. Kembalikan HANYA JSON valid tanpa teks tambahan.

PROFIL GAYA:
${profileSummary}

KUTIPAN NOVEL (2000 kata pertama):
${excerpt}

Kembalikan JSON dengan format persis ini:
{
  "score": <keseluruhan 0-100>,
  "vocabulary_match": <0-100>,
  "sentence_rhythm_match": <0-100>,
  "tone_match": <0-100>,
  "pov_consistency": <0-100>,
  "feedback": "<1 kalimat>"
}`;

  return await callEvaluator(prompt);
}

// ── Phase 1B: Quality Evaluator ────────────────────────────────────────────
async function evaluateQuality(novelText, outline) {
  const text = novelText.length > 12000 ? novelText.slice(0, 12000) + '\n[...truncated]' : novelText;
  const outlineStr = typeof outline === 'string' ? outline.slice(0, 1500) : JSON.stringify(outline || {}).slice(0, 1500);

  const prompt = `Kamu adalah editor profesional. Evaluasi novel ini dari segi kualitas naratif.
Berikan skor 0-100 untuk setiap dimensi. Kembalikan HANYA JSON valid tanpa teks tambahan.

KERANGKA ASLI:
${outlineStr}

TEKS NOVEL:
${text}

Kembalikan JSON dengan format persis ini:
{
  "score": <keseluruhan 0-100>,
  "plot_coherence": <0-100>,
  "character_consistency": <0-100>,
  "pacing": <0-100>,
  "chapter_transitions": <0-100>,
  "prose_clarity": <0-100>,
  "feedback": "<2 kalimat>",
  "weakest_chapter": <nomor bab atau 1>
}`;

  return await callEvaluator(prompt);
}

// ── Phase 1C: Originality Evaluator ───────────────────────────────────────
async function evaluateOriginality(novelText, topChunks) {
  if (!topChunks || topChunks.length === 0) {
    return {
      score: 90, similarity_percentage: 5, flagged_sentences: [],
      verdict: 'original', feedback: 'No reference chunks available — assumed original.',
      skipped: true
    };
  }

  const excerpt = novelText.slice(0, 4000);
  const refs = topChunks.slice(0, 5).map((c, i) =>
    `[Ref ${i + 1}]: ${(c.text || '').slice(0, 300)}`
  ).join('\n');

  const prompt = `Bandingkan kutipan novel ini dengan kutipan referensi dari database sumber.
Deteksi kalimat yang terlalu mirip (>70% tumpang tindih) dengan referensi.
Kembalikan HANYA JSON valid tanpa teks tambahan.

KUTIPAN REFERENSI:
${refs}

KUTIPAN NOVEL:
${excerpt}

Kembalikan JSON dengan format persis ini:
{
  "score": <0-100>,
  "similarity_percentage": <0-100>,
  "flagged_sentences": ["<kalimat jika ada>"],
  "verdict": "<orisinal|terpengaruh|terlalu_mirip>",
  "feedback": "<1 kalimat>"
}`;

  return await callEvaluator(prompt);
}

// ── Phase 1D: Aggregate ────────────────────────────────────────────────────
function aggregateScores(styleScore, qualityScore, originalityScore) {
  const s = styleScore?.score ?? 75;
  const q = qualityScore?.score ?? 70;
  const o = originalityScore?.score ?? 85;

  const total = Math.round(s * 0.30 + q * 0.50 + o * 0.20);

  let grade, verdict;
  if (total >= 90)      { grade = 'A'; verdict = 'excellent'; }
  else if (total >= 75) { grade = 'B'; verdict = 'good'; }
  else if (total >= 60) { grade = 'C'; verdict = 'needs_improvement'; }
  else if (total >= 45) { grade = 'D'; verdict = 'poor'; }
  else                  { grade = 'F'; verdict = 'regenerate'; }

  return { total, grade, verdict, style: styleScore, quality: qualityScore, originality: originalityScore };
}

// ── Phase 1E: Run Full Evaluation ──────────────────────────────────────────
async function runEvaluation(novelId, styleProfiles, topChunks, outline, novelText, onProgress) {
  const db = getSupabase();

  const wordCount = novelText.trim().split(/\s+/).length;
  const tooShort = wordCount < 500;

  onProgress?.('style');
  onProgress?.('quality');
  onProgress?.('originality');

  const [styleScore, qualityScore, originalityScore] = await Promise.all([
    evaluateStyle(novelText, styleProfiles).catch(e => {
      console.error('Style eval error:', e.message);
      return { score: 70, feedback: 'Evaluation failed.', error: true };
    }),
    evaluateQuality(novelText, outline).catch(e => {
      console.error('Quality eval error:', e.message);
      return { score: 65, feedback: 'Evaluation failed.', weakest_chapter: 1, error: true };
    }),
    evaluateOriginality(novelText, topChunks).catch(e => {
      console.error('Originality eval error:', e.message);
      return { score: 80, verdict: 'original', feedback: 'Evaluation failed.', error: true };
    })
  ]);

  onProgress?.('aggregating');

  const report = aggregateScores(styleScore, qualityScore, originalityScore);
  report.novel_id = novelId;
  report.word_count = wordCount;
  report.too_short_warning = tooShort;

  // Save to DB
  const insertResult = await db.from('eval_results').insert({
    novel_id: novelId,
    total_score: report.total,
    grade: report.grade,
    verdict: report.verdict,
    style_score: styleScore.score ?? null,
    style_json: JSON.stringify(styleScore),
    quality_score: qualityScore.score ?? null,
    quality_json: JSON.stringify(qualityScore),
    originality_score: originalityScore.score ?? null,
    originality_json: JSON.stringify(originalityScore),
    weakest_chapter: qualityScore.weakest_chapter ?? null
  });
  throwIfError(insertResult, 'runEvaluation:insert');

  return report;
}

// ── Phase 4: Mimicry Score Evaluator ──────────────────────────────────────
async function evaluateMimicry(generatedText, dna) {
  const excerpt = generatedText.split(/\s+/).slice(0, 2000).join(' ');
  const L = dna.language || {};
  const S = dna.style || {};
  const St = dna.structure || {};
  const C = dna.character || {};
  const H = dna.human_touch || {};
  const T = dna.thematic || {};

  const prompt = `Kamu adalah analis sastra. Bandingkan teks yang dihasilkan ini dengan profil DNA pengarang di bawah.
Berikan skor 0-100 seberapa baik teks meniru setiap dimensi DNA.
Kembalikan HANYA JSON valid — tanpa prosa.

PROFIL DNA PENGARANG:
- Bahasa: kosakata=${L.vocabulary_level}, ritme=${L.sentence_avg_length} kata/kalimat, kata_khas=[${(L.special_words||[]).join(', ')}]
- Gaya: POV=${S.pov}, kala=${S.tense}, nada=${S.narrative_voice_tone}, ritme=${S.sentence_rhythm}
- Struktur: pacing=${St.pacing_pattern}, pembuka_bab=${St.chapter_opening_style}
- Karakter: suara_protagonis=${C.protagonist_voice}, dialog=${C.dialogue_style}
- Sentuhan Manusia: pengisi=[${(H.filler_expressions||[]).join(', ')}], humor=${H.humor_style}
- Tema: ${(T.core_themes||[]).join(', ')}, ambiguitas_moral=${T.moral_ambiguity_level}

KUTIPAN TEKS YANG DIHASILKAN:
${excerpt}

Kembalikan JSON persis ini:
{
  "overall": <0-100>,
  "language_match": <0-100>,
  "style_match": <0-100>,
  "structure_match": <0-100>,
  "character_voice_match": <0-100>,
  "human_touch_match": <0-100>,
  "thematic_match": <0-100>,
  "strongest_match": "<nama dimensi>",
  "weakest_match": "<nama dimensi>",
  "feedback": "<2 kalimat>"
}`;

  return await callEvaluator(prompt).catch(e => {
    console.error('Mimicry eval error:', e.message);
    return {
      overall: 70, language_match: 70, style_match: 70,
      structure_match: 70, character_voice_match: 70,
      human_touch_match: 70, thematic_match: 70,
      strongest_match: 'style', weakest_match: 'human_touch',
      feedback: 'Evaluation failed — fallback scores assigned.',
      error: true
    };
  });
}

module.exports = {
  evaluateStyle,
  evaluateQuality,
  evaluateOriginality,
  aggregateScores,
  runEvaluation,
  evaluateMimicry
};
