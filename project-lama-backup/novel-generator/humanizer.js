/*
 * HUMAN TOUCH POST-PROCESSOR
 * Applies a final pass to generated novel chapters to make them feel
 * authentically human — using the Human Touch DNA from the source novel.
 *
 * Processes chapter by chapter (not full novel) to stay within context limits.
 * Uses claude-sonnet-4-6, max_tokens: 2000 per chapter.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getAnthropicAuth } = require('./auth');

const client = new Anthropic(getAnthropicAuth());
const MODEL = 'claude-sonnet-4-6';

function arr(v, sep = ', ', fallback = 'none') {
  if (Array.isArray(v) && v.length) return v.join(sep);
  return fallback;
}

// ── Phase 7A: Humanize a single chapter ───────────────────────────────────
async function humanizeText(text, humanTouchDNA, onChunk) {
  const H = humanTouchDNA || {};

  const system = `Kamu adalah editor sastra yang mengkhususkan diri membuat teks buatan AI terasa autentik seperti tulisan manusia.
Terapkan sentuhan akhir yang menambahkan kehangatan, ketidaksempurnaan, dan kepribadian — tanpa mengubah plot, konten dialog, atau nama karakter.
Kembalikan HANYA teks yang telah direvisi, tanpa komentar, tanpa label.`;

  const userMsg = `Terapkan sentuhan akhir ini agar teks terasa lebih autentik ditulis oleh pengarang manusia:

1. EKSPRESI PENGISI — Selipkan ekspresi ini di momen percakapan yang natural: ${arr(H.filler_expressions)}
2. KALIMAT FRAGMENTARIS — Tambahkan fragmen yang disengaja saat puncak ketegangan: ${arr(H.imperfection_markers, '; ', 'gunakan hemat untuk efek')}
3. KEBOCORAN EMOSI — Biarkan emosi narrator meresap dengan gaya ini: ${H.emotional_leakage || 'pergeseran pilihan kata yang halus'}
4. RITME NAPAS — Terapkan ritme paragraf ini: ${H.breathing_rhythm || 'pendek untuk ketegangan, panjang untuk refleksi'}
5. PREFERENSI INDRAWI — Condongkan ke: ${H.sensory_preference || 'indra yang seimbang'}
6. HUMOR — Jika ada kesempatan natural, terapkan: ${H.humor_style || 'tidak ada — pertahankan serius'}

ATURAN:
- JANGAN mengubah peristiwa plot, nama karakter, atau konten dialog apa pun
- JANGAN menambahkan poin plot baru
- JANGAN menghapus seluruh paragraf
- Buat perubahan terasa organik — tidak dipaksakan
- Keluarkan teks bab yang telah direvisi secara lengkap

TEKS BAB:
${text}`;

  const stream = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    stream: true,
    system,
    messages: [{ role: 'user', content: userMsg }]
  });

  let humanized = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      humanized += event.delta.text;
      onChunk?.(event.delta.text);
    }
  }

  // Fallback: if humanizer returns less than 50% of original length, something went wrong
  const originalWords = text.split(/\s+/).length;
  const humanizedWords = humanized.trim().split(/\s+/).length;
  if (humanizedWords < originalWords * 0.5) {
    console.warn('[Humanizer] Output too short — returning original text');
    return text;
  }

  return humanized.trim();
}

// ── Phase 7B: Humanize all chapters ───────────────────────────────────────
async function humanizeAllChapters(chapters, humanTouchDNA, onChapterDone) {
  const results = [];

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    onChapterDone?.('start', ch.number || i + 1);

    try {
      const humanizedContent = await humanizeText(ch.content, humanTouchDNA);
      results.push({ ...ch, content: humanizedContent, humanized: true });
      onChapterDone?.('done', ch.number || i + 1);
    } catch (err) {
      console.error(`[Humanizer] Chapter ${ch.number || i + 1} failed:`, err.message);
      results.push({ ...ch, humanized: false }); // Keep original on error
      onChapterDone?.('error', ch.number || i + 1);
    }
  }

  return results;
}

module.exports = { humanizeText, humanizeAllChapters };
