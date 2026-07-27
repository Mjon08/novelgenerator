function buildSystemPrompt(styleProfiles, relevantChunks, userRequest) {
  const lines = [];

  lines.push('Kamu adalah novelis master dengan pengetahuan mendalam tentang kerajinan sastra.');
  lines.push('Tugasmu adalah menulis novel dalam Bahasa Indonesia yang natural, memukau, dan berkualitas tinggi.');
  lines.push('');

  if (styleProfiles.length > 0) {
    lines.push('═══ PENGARUH GAYA MENULIS ═══');
    lines.push('Pelajari gaya-gaya penulisan ini dengan seksama dan padukan secara natural ke dalam tulisanmu:');
    lines.push('');

    const fullProfiles = styleProfiles.slice(0, 2);
    const toneProfiles = styleProfiles.slice(2, 5);

    for (const p of fullProfiles) {
      let themes = [];
      let genreTags = [];
      let sigPhrases = [];
      try { themes = JSON.parse(p.themes || '[]'); } catch {}
      try { genreTags = JSON.parse(p.genre_tags || '[]'); } catch {}
      try { sigPhrases = JSON.parse(p.signature_phrases || '[]'); } catch {}

      lines.push(`--- ${p.title}${p.author ? ` karya ${p.author}` : ''} ---`);
      lines.push(`Gaya Penulisan: ${p.writing_style}`);
      lines.push(`Ritme Kalimat: ${p.sentence_rhythm}`);
      lines.push(`Sudut Pandang: ${p.pov}`);
      lines.push(`Nada: ${p.tone}`);
      lines.push(`Tingkat Kosakata: ${p.vocabulary_level}`);
      if (themes.length) lines.push(`Tema: ${themes.join(', ')}`);
      if (genreTags.length) lines.push(`Tag Genre: ${genreTags.join(', ')}`);
      if (sigPhrases.length) lines.push(`Pola Khas: ${sigPhrases.join(' | ')}`);
      if (p.sample_paragraph) {
        lines.push(`Contoh Paragraf:`);
        lines.push(`"${p.sample_paragraph}"`);
      }
      lines.push('');
    }

    if (toneProfiles.length > 0) {
      lines.push('Pengaruh nada tambahan:');
      for (const p of toneProfiles) {
        lines.push(`• ${p.title}: nada ${p.tone}, ritme ${p.sentence_rhythm}`);
      }
      lines.push('');
    }
  }

  if (relevantChunks.length > 0) {
    lines.push('═══ KUTIPAN REFERENSI ═══');
    lines.push('Gunakan kutipan-kutipan ini sebagai INSPIRASI SAJA — jangan menyalin kalimat, serap ritme dan suaranya:');
    lines.push('');

    for (const chunk of relevantChunks.slice(0, 5)) {
      lines.push(`[Kutipan dari novel referensi]`);
      lines.push(chunk.text.slice(0, 500));
      lines.push('');
    }
  }

  lines.push('═══ INSTRUKSI PENULISAN ═══');
  lines.push('• Tulis SEPENUHNYA dalam Bahasa Indonesia yang natural dan mengalir');
  lines.push('• Padukan gaya-gaya penulisan secara natural — jangan menyalin kalimat apapun secara langsung');
  lines.push('• Hasil harus terasa orisinal dan kohesif, bukan sekadar campuran');
  lines.push('• Pertahankan nada dan ritme yang paling sesuai dengan genre yang diminta');
  lines.push('• Gunakan tema dan tingkat kosakata yang paling cocok untuk premis pengguna');
  lines.push('• Dialog harus natural seperti percakapan nyata orang Indonesia');

  const styleInfluences = styleProfiles.map(p => ({
    id: p.novel_id,
    title: p.title,
    author: p.author || null,
    tone: p.tone,
    style: p.writing_style
  }));

  return {
    systemPrompt: lines.join('\n'),
    styleInfluences
  };
}

module.exports = { buildSystemPrompt };
