const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const Anthropic = require('@anthropic-ai/sdk');
const {
  DEFAULT_MODEL,
  isFreeModel,
  assertModelAllowed,
  nextFreeModel
} = require('./modelRegistry');

/**
 * Menerjemahkan nama model apa pun menjadi id yang dikenal OpenRouter.
 * Model yang sudah valid diteruskan apa adanya; alias internal dan nilai
 * kosong jatuh ke model gratis bawaan — TIDAK PERNAH ke router berbayar.
 */
function normalisasiModel(model) {
  if (!model) return DEFAULT_MODEL;
  if (model.endsWith(':free')) return model;
  // Id Anthropic langsung (claude-*) tidak ada di katalog OpenRouter.
  if (/^claude[-_]/i.test(model)) return DEFAULT_MODEL;
  return model;
}

function createOpenRouterClient(apiKey) {
  return {
    messages: {
      create: async (params) => {
        // Alias internal (mis. "claude-sonnet-4-6") tidak dikenal OpenRouter.
        // Dulu semuanya — TERMASUK model ":free" — dibelokkan ke
        // "openrouter/auto" yang BERBAYAR, sehingga pilihan "gratis" pengguna
        // diam-diam menjadi panggilan berbayar. Sekarang alias tak dikenal
        // jatuh ke DEFAULT_MODEL yang gratis.
        const initialModel = normalisasiModel(params.model);
        assertModelAllowed(initialModel);
        const messages = [];

        if (params.system) {
          messages.push({ role: 'system', content: params.system });
        }

        if (params.messages) {
          params.messages.forEach(m => {
            messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
          });
        }

        async function executeCall(targetModel, sudahDicoba = []) {
          const body = JSON.stringify({
            model: targetModel,
            messages: messages,
            max_tokens: params.max_tokens || 4096,
            stream: Boolean(params.stream)
          });

          if (params.stream) {
            return new Promise((resolve, reject) => {
              const req = https.request({
                hostname: 'openrouter.ai',
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                  'HTTP-Referer': 'http://localhost:3000',
                  'X-Title': 'novelGENerator Studio'
                }
              }, async (res) => {
                if (res.statusCode !== 200) {
                  let errBody = '';
                  for await (const chunk of res) errBody += chunk.toString();
                  try {
                    const parsedErr = JSON.parse(errBody);
                    const msg = (parsedErr.error && parsedErr.error.message) || errBody;
                    const berikutnya = nextFreeModel(targetModel, sudahDicoba);
                    if (berikutnya) {
                      console.warn(`[OpenRouter] Model ${targetModel} gagal (${msg}). Beralih ke model GRATIS berikutnya: ${berikutnya}`);
                      return resolve(await executeCall(berikutnya, [...sudahDicoba, targetModel]));
                    }
                    return reject(new Error(`Semua model gratis sedang tidak tersedia. Kegagalan terakhir pada ${targetModel}: ${msg}`));
                  } catch (e) {
                    return reject(new Error(`OpenRouter HTTP ${res.statusCode}: ${errBody}`));
                  }
                }

                async function* streamGenerator() {
                  let buffer = '';
                  for await (const chunk of res) {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop();
                    for (const line of lines) {
                      if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') continue;
                        try {
                          const parsed = JSON.parse(dataStr);
                          const deltaText = parsed.choices && parsed.choices[0] && parsed.choices[0].delta ? (parsed.choices[0].delta.content || '') : '';
                          if (deltaText) {
                            yield {
                              type: 'content_block_delta',
                              delta: { type: 'text_delta', text: deltaText }
                            };
                          }
                        } catch (e) {}
                      }
                    }
                  }
                }
                resolve(streamGenerator());
              });
              req.on('error', reject);
              req.write(body);
              req.end();
            });
          }

          return new Promise((resolve, reject) => {
            const req = https.request({
              hostname: 'openrouter.ai',
              path: '/api/v1/chat/completions',
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'novelGENerator Studio'
              }
            }, res => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', async () => {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.error) {
                    const msg = parsed.error.message || JSON.stringify(parsed.error);
                    const berikutnya = nextFreeModel(targetModel, sudahDicoba);
                    if (berikutnya) {
                      console.warn(`[OpenRouter] Model ${targetModel} gagal (${msg}). Beralih ke model GRATIS berikutnya: ${berikutnya}`);
                      return resolve(await executeCall(berikutnya, [...sudahDicoba, targetModel]));
                    }
                    return reject(new Error(`Semua model gratis sedang tidak tersedia. Kegagalan terakhir pada ${targetModel}: ${msg}`));
                  }
                  const textContent = parsed.choices && parsed.choices[0] && parsed.choices[0].message ? parsed.choices[0].message.content : '';
                  resolve({
                    content: [{ type: 'text', text: textContent }]
                  });
                } catch (e) { reject(e); }
              });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
          });
        }

        return await executeCall(initialModel);
      }
    }
  };
}

function getAnthropicAuth() {
  const envPath = path.join(__dirname, '.env');
  let openrouterKey = process.env.OPENROUTER_API_KEY || null;
  let anthropicKey = process.env.ANTHROPIC_API_KEY || null;

  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const orMatch = line.match(/^OPENROUTER_API_KEY\s*=\s*(.+)$/);
      if (orMatch && orMatch[1].trim() && !orMatch[1].includes('your-openrouter-key')) {
        openrouterKey = orMatch[1].trim();
      }
      const antMatch = line.match(/^ANTHROPIC_API_KEY\s*=\s*(.+)$/);
      if (antMatch && antMatch[1].trim()) {
        anthropicKey = antMatch[1].trim();
      }
    }
  }

  if (openrouterKey) {
    return createOpenRouterClient(openrouterKey);
  }

  if (anthropicKey) {
    return new Anthropic({ apiKey: anthropicKey });
  }

  throw new Error('No Anthropic or OpenRouter credentials found in .env');
}

module.exports = { getAnthropicAuth, createOpenRouterClient };
