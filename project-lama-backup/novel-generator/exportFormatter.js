/*
 * FORMATTER EKSPOR NOVEL INDONESIA
 * Memformat novel ke berbagai platform: Wattpad, KBM App, Storial.co, Google Docs
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getAnthropicAuth } = require('./auth');
const path = require('path');
const fs = require('fs').promises;

const client = new Anthropic(getAnthropicAuth());

// ── Utilitas ───────────────────────────────────────────────────────────────

function hitungKata(teks) {
  return (teks || '').trim().split(/\s+/).filter(w => w.length > 0).length;
}

function sanitasiJudul(judul) {
  return (judul || 'novel').replace(/[^\w\s\-]/g, '').replace(/\s+/g, '_').slice(0, 50);
}

function formatTanggal() {
  return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function deteksiPeringatan(genre, konten) {
  const g = (genre || '').toLowerCase();
  const k = (konten || '').toLowerCase();
  const peringatan = [];

  if (g.includes('horor') || g.includes('thriller')) peringatan.push('Mengandung konten horor dan ketegangan');
  if (g.includes('dewasa') || k.includes('18+')) peringatan.push('Konten Dewasa (18+)');
  if (g.includes('romance') && !g.includes('islami')) peringatan.push('Mengandung konten romantis');
  if (g.includes('islami') || g.includes('hijrah')) peringatan.push('Novel Islami — bebas konten dewasa');

  return peringatan;
}

// ── Generator Tag & Sinopsis via Claude ───────────────────────────────────

async function generateTags(novel, outline, genre) {
  const prompt = `Kamu adalah editor platform novel digital Indonesia yang berpengalaman.

Berikan 10-15 tag populer untuk novel berikut yang cocok untuk platform Wattpad Indonesia dan KBM App.
Format tag dengan tanda # dan tanpa spasi. Gabungkan bahasa Indonesia dan Inggris sesuai tren platform.

Judul: ${novel.title}
Genre: ${genre || novel.genre}
Sinopsis singkat: ${(outline || '').slice(0, 500)}

Contoh format tag: #romanceindonesia #CEO #officelove #slowburn #enemiestolovers

Kembalikan HANYA array JSON berisi string tag, tidak ada teks lain.
Contoh: ["#romanceindonesia", "#CEO", "#slowburn"]`;

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });
    const raw = resp.content[0].text;
    const match = raw.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch {
    return defaultTags(genre || novel.genre || '');
  }
}

function defaultTags(genre) {
  const g = genre.toLowerCase();
  if (g.includes('romance') && g.includes('ceo')) return ['#romanceindonesia', '#CEO', '#officelove', '#slowburn', '#enemies2lovers'];
  if (g.includes('islami')) return ['#romanceislami', '#hijrah', '#nikahyuk', '#halal', '#santri'];
  if (g.includes('horor')) return ['#hororindonesia', '#kuntilanak', '#pocong', '#misteri', '#seramm'];
  if (g.includes('fantasi')) return ['#fantasiindonesia', '#kerajaannusantara', '#pewayangan', '#epicfantasy'];
  if (g.includes('kampus')) return ['#romancekampus', '#mahasiswa', '#collegeromnace', '#campuslife'];
  return ['#novelindonesia', '#fiksi', '#indonesia', '#bacaan', '#novel'];
}

async function generateSinopsisMarketing(novel, outline) {
  const prompt = `Kamu adalah copywriter platform novel digital Indonesia yang handal.

Buat sinopsis marketing 3 paragraf untuk novel berikut.
Paragraf 1: Hook kuat yang langsung menarik perhatian pembaca (buat mereka penasaran).
Paragraf 2: Konflik utama tanpa spoiler besar — teasing, bukan menceritakan.
Paragraf 3: Pertanyaan yang bikin pembaca tidak bisa tidak membaca + call to action.

Gaya: Emosional, menarik, sesuai genre. Gunakan Bahasa Indonesia yang mengalir natural.

Judul novel: ${novel.title}
Genre: ${novel.genre}
Kerangka cerita: ${(outline || '').slice(0, 1000)}

Kembalikan teks sinopsis saja, tanpa label atau komentar.`;

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });
    return resp.content[0].text.trim();
  } catch {
    return `${novel.title} — sebuah kisah yang akan membuat kamu tidak bisa berhenti membaca.\n\nKetika dua jiwa yang berbeda dipersatukan oleh takdir, tidak ada yang tahu ke mana arah cerita ini akan membawa mereka.\n\nSiapkah kamu menjadi bagian dari perjalanan ini?`;
  }
}

// ── Format Wattpad ─────────────────────────────────────────────────────────

async function formatForWattpad(novel, outline) {
  const tags = await generateTags(novel, outline, novel.genre);
  const sinopsis = await generateSinopsisMarketing(novel, outline);
  const peringatan = deteksiPeringatan(novel.genre, novel.chapters?.map(c => c.content).join(' ') || '');
  const totalKata = (novel.chapters || []).reduce((sum, c) => sum + hitungKata(c.content), 0);

  let output = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${novel.title.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Genre: ${novel.genre}
Tags: ${tags.join(' ')}
Total Kata: ${totalKata.toLocaleString('id-ID')}
Total Bab: ${(novel.chapters || []).length}
${peringatan.length ? '\nPeringatan Konten:\n' + peringatan.map(p => `⚠️ ${p}`).join('\n') : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SINOPSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${sinopsis}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const bab of (novel.chapters || [])) {
    output += `---BAB ${bab.number}: ${(bab.title || '').toUpperCase()}---\n\n`;
    output += (bab.content || '').trim() + '\n\n\n';
  }

  output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dibuat dengan novelGENerator AI • ${formatTanggal()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  return { konten: output, tags, sinopsis, namaFile: `${sanitasiJudul(novel.title)}_wattpad.txt` };
}

// ── Format KBM App ─────────────────────────────────────────────────────────

async function formatForKBM(novel, outline) {
  const tags = await generateTags(novel, outline, novel.genre);
  const sinopsis = await generateSinopsisMarketing(novel, outline);
  const peringatan = deteksiPeringatan(novel.genre, '');
  const totalKata = (novel.chapters || []).reduce((sum, c) => sum + hitungKata(c.content), 0);

  // Kategori KBM
  const g = (novel.genre || '').toLowerCase();
  let kategoriKBM = 'Fiksi Umum';
  if (g.includes('romance') || g.includes('cinta')) kategoriKBM = 'Romansa';
  else if (g.includes('islami') || g.includes('hijrah')) kategoriKBM = 'Islami';
  else if (g.includes('horor') || g.includes('thriller')) kategoriKBM = 'Horor & Thriller';
  else if (g.includes('fantasi')) kategoriKBM = 'Fantasi';
  else if (g.includes('sma') || g.includes('teenlit')) kategoriKBM = 'Teenlit';

  let output = `▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
NOVEL KBM APP
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

Judul          : ${novel.title}
Kategori KBM   : ${kategoriKBM}
Genre          : ${novel.genre}
Total Bab      : ${(novel.chapters || []).length}
Total Kata     : ${totalKata.toLocaleString('id-ID')}
${peringatan.length ? `Rating         : ${peringatan.some(p => p.includes('18+')) ? '18+' : 'Semua Umur'}` : 'Rating         : Semua Umur'}

Tags:
${tags.join(' ')}

${peringatan.length ? '⚠️ PERINGATAN KONTEN:\n' + peringatan.join('\n') + '\n' : ''}
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
SINOPSIS
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

${sinopsis}

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
ISI NOVEL
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓\n\n`;

  for (const bab of (novel.chapters || [])) {
    output += `╔══════════════════════════════════════╗\n`;
    output += `║  BAB ${bab.number}: ${bab.title || ''}\n`;
    output += `╚══════════════════════════════════════╝\n\n`;
    output += (bab.content || '').trim() + '\n\n***\n\n';
  }

  output += `\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓\nDibuat dengan novelGENerator AI • ${formatTanggal()}\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓`;

  return { konten: output, tags, sinopsis, namaFile: `${sanitasiJudul(novel.title)}_kbm.txt` };
}

// ── Format Storial.co ──────────────────────────────────────────────────────

async function formatForStorial(novel, outline) {
  const sinopsis = await generateSinopsisMarketing(novel, outline);
  const totalKata = (novel.chapters || []).reduce((sum, c) => sum + hitungKata(c.content), 0);

  let output = `STORIAL.CO — FORMAT UNGGAH\n`;
  output += `${'='.repeat(50)}\n\n`;
  output += `Judul Novel   : ${novel.title}\n`;
  output += `Genre         : ${novel.genre}\n`;
  output += `Jumlah Bab    : ${(novel.chapters || []).length}\n`;
  output += `Jumlah Kata   : ${totalKata.toLocaleString('id-ID')} kata\n`;
  output += `Tanggal       : ${formatTanggal()}\n\n`;
  output += `${'='.repeat(50)}\nSINOPSIS\n${'='.repeat(50)}\n\n${sinopsis}\n\n`;
  output += `${'='.repeat(50)}\nISI NOVEL\n${'='.repeat(50)}\n\n`;

  for (const bab of (novel.chapters || [])) {
    const kataPerBab = hitungKata(bab.content);
    output += `[BAB ${bab.number}: ${bab.title || ''}]\n`;
    output += `(${kataPerBab.toLocaleString('id-ID')} kata)\n\n`;
    output += (bab.content || '').trim() + '\n\n';
    output += `${'─'.repeat(50)}\n\n`;
  }

  output += `Dibuat dengan novelGENerator AI • ${formatTanggal()}`;

  return { konten: output, sinopsis, namaFile: `${sanitasiJudul(novel.title)}_storial.txt` };
}

// ── Format Google Docs ─────────────────────────────────────────────────────

async function formatForGoogleDocs(novel, outline) {
  const sinopsis = await generateSinopsisMarketing(novel, outline);
  const totalKata = (novel.chapters || []).reduce((sum, c) => sum + hitungKata(c.content), 0);

  let output = `${novel.title}\n`;
  output += `Genre: ${novel.genre} | ${totalKata.toLocaleString('id-ID')} kata | ${(novel.chapters || []).length} bab\n\n`;
  output += `SINOPSIS\n\n${sinopsis}\n\n`;

  for (const bab of (novel.chapters || [])) {
    output += `\n\nBAB ${bab.number}: ${(bab.title || '').toUpperCase()}\n\n`;
    output += (bab.content || '').trim() + '\n';
  }

  output += `\n\nDibuat dengan novelGENerator AI • ${formatTanggal()}`;

  return { konten: output, sinopsis, namaFile: `${sanitasiJudul(novel.title)}_googledocs.txt` };
}

// ── Format NovelToon ───────────────────────────────────────────────────────

async function formatForNovelToon(novel, outline) {
  const tags = await generateTags(novel, outline, novel.genre);
  const sinopsis = await generateSinopsisMarketing(novel, outline);

  let output = `NOVELTOON — FORMAT UPLOAD\n${'='.repeat(50)}\n\n`;
  output += `Title: ${novel.title}\nGenre: ${novel.genre}\nLanguage: Indonesian\n\n`;
  output += `Synopsis:\n${sinopsis}\n\nTags: ${tags.slice(0, 8).join(', ')}\n\n${'='.repeat(50)}\n\n`;

  for (const bab of (novel.chapters || [])) {
    output += `Chapter ${bab.number}: ${bab.title || ''}\n\n`;
    output += (bab.content || '').trim() + '\n\n---\n\n';
  }

  return { konten: output, tags, sinopsis, namaFile: `${sanitasiJudul(novel.title)}_noveltoon.txt` };
}

// ── Master: format semua platform ─────────────────────────────────────────

async function formatSemua(novel, outline, eksporDir) {
  await fs.mkdir(eksporDir, { recursive: true });

  const [wattpad, kbm, storial, gdocs, noveltoon] = await Promise.all([
    formatForWattpad(novel, outline),
    formatForKBM(novel, outline),
    formatForStorial(novel, outline),
    formatForGoogleDocs(novel, outline),
    formatForNovelToon(novel, outline)
  ]);

  const hasil = { wattpad, kbm, storial, googledocs: gdocs, noveltoon };

  for (const [platform, data] of Object.entries(hasil)) {
    await fs.writeFile(
      path.join(eksporDir, data.namaFile),
      data.konten,
      { encoding: 'utf-8' }
    );
  }

  return {
    tags: wattpad.tags,
    sinopsis_marketing: wattpad.sinopsis,
    file: Object.fromEntries(Object.entries(hasil).map(([p, d]) => [p, d.namaFile]))
  };
}

module.exports = {
  formatForWattpad,
  formatForKBM,
  formatForStorial,
  formatForGoogleDocs,
  formatForNovelToon,
  formatSemua,
  generateTags,
  generateSinopsisMarketing
};
