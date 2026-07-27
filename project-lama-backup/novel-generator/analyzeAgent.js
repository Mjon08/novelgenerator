const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase, throwIfError } = require('./database/supabaseClient');
const { getAnthropicAuth } = require('./auth');
const { checkUsageLimit, recordApiUsage } = require('./usageLimiter');

const client = new Anthropic(getAnthropicAuth());

async function analyzeStyle(fullText, title) {
  await checkUsageLimit();
  const excerpt = fullText.slice(0, 12000);

  const message = await client.messages.create({

    model: 'claude-opus-4-8',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Analyze this novel excerpt from "${title}" and return ONLY valid JSON with these exact fields:
{
  "writing_style": "string describing overall style, e.g. 'lyrical and slow-paced'",
  "sentence_rhythm": "short and punchy | long and flowing | mixed",
  "pov": "first-person | third-person-limited | omniscient",
  "tone": "string describing tone, e.g. 'melancholic', 'humorous', 'dark'",
  "themes": ["theme1", "theme2", "theme3"],
  "vocabulary_level": "simple | intermediate | literary",
  "genre_tags": ["tag1", "tag2"],
  "signature_phrases": ["phrase1", "phrase2", "phrase3"],
  "sample_paragraph": "the single most representative paragraph from the text"
}

Return ONLY the JSON object. No explanation.

EXCERPT:
${excerpt}`
      }
    ]
  });

  await recordApiUsage(0.02);
  const raw = message.content[0].text.trim();

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse style JSON from Claude response');
  return JSON.parse(jsonMatch[0]);
}

async function saveStyleProfile(novelId, styleJSON) {
  const db = getSupabase();
  const result = await db.from('style_profiles').insert({
    novel_id: novelId,
    writing_style: styleJSON.writing_style || '',
    sentence_rhythm: styleJSON.sentence_rhythm || '',
    pov: styleJSON.pov || '',
    tone: styleJSON.tone || '',
    themes: JSON.stringify(styleJSON.themes || []),
    vocabulary_level: styleJSON.vocabulary_level || '',
    genre_tags: JSON.stringify(styleJSON.genre_tags || []),
    signature_phrases: JSON.stringify(styleJSON.signature_phrases || []),
    sample_paragraph: styleJSON.sample_paragraph || '',
    raw_json: JSON.stringify(styleJSON)
  });
  throwIfError(result, 'saveStyleProfile');
}

module.exports = { analyzeStyle, saveStyleProfile };
