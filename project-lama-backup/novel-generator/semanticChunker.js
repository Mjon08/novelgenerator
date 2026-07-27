/*
 * SEMANTIC CHUNKER — Step 3 pipeline DNA
 *
 * Memotong naskah mengikuti batas makna (bab → adegan → paragraf),
 * bukan memotong buta setiap N karakter.
 *
 * Setiap potongan membawa metadata posisinya (bab ke berapa, adegan ke berapa,
 * di bagian mana dari novel) supaya AI tidak kehilangan konteks hubungan
 * antar potongan — ini syarat eksplisit di PRD.
 *
 * Ukuran potongan menyesuaikan context window model: model dengan jendela
 * besar mendapat potongan besar sehingga seluruh novel terbaca dalam
 * sedikit panggilan.
 */

const { maxWordsPerCall } = require('./modelRegistry');

/**
 * Menandai posisi relatif sebuah bab di dalam novel.
 * Berguna untuk analisis pacing: pembukaan, pertengahan, dan penutup
 * punya karakter berbeda dan harus dinilai berbeda.
 */
function positionLabel(index, total) {
  if (total <= 1) return 'utuh';
  const ratio = index / (total - 1);
  if (ratio <= 0.15) return 'pembuka';
  if (ratio <= 0.45) return 'babak-awal';
  if (ratio <= 0.65) return 'titik-tengah';
  if (ratio <= 0.9) return 'babak-akhir';
  return 'penutup';
}

/**
 * Memecah teks panjang pada batas paragraf agar tidak ada potongan yang
 * melebihi batas kata. Dipakai sebagai jaring pengaman untuk bab/adegan
 * yang kelewat panjang.
 */
function splitOnParagraphs(text, maxWords) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const pieces = [];
  let acc = [];
  let accWords = 0;

  for (const p of paragraphs) {
    const w = p.split(/\s+/).filter(Boolean).length;

    // Paragraf tunggal yang melebihi batas dipotong pada batas kalimat.
    if (w > maxWords) {
      if (acc.length) { pieces.push(acc.join('\n\n')); acc = []; accWords = 0; }
      const sentences = p.match(/[^.!?…]+[.!?…]+/g) || [p];
      let sAcc = [];
      let sWords = 0;
      for (const s of sentences) {
        const sw = s.split(/\s+/).filter(Boolean).length;
        if (sWords + sw > maxWords && sAcc.length) {
          pieces.push(sAcc.join(' ').trim());
          sAcc = [];
          sWords = 0;
        }
        sAcc.push(s);
        sWords += sw;
      }
      if (sAcc.length) pieces.push(sAcc.join(' ').trim());
      continue;
    }

    if (accWords + w > maxWords && acc.length) {
      pieces.push(acc.join('\n\n'));
      acc = [];
      accWords = 0;
    }
    acc.push(p);
    accWords += w;
  }

  if (acc.length) pieces.push(acc.join('\n\n'));
  return pieces.filter(Boolean);
}

/**
 * LEVEL 1 — potongan analisis adegan.
 *
 * Menggabungkan adegan-adegan berurutan sampai mendekati kapasitas model,
 * tanpa pernah memotong di tengah adegan. Untuk model context besar,
 * satu potongan bisa memuat banyak bab sekaligus.
 */
function buildSceneChunks(preprocessed, modelName, opts = {}) {
  const budget = opts.maxWords || maxWordsPerCall(modelName);
  // Sisakan ruang untuk metadata dan instruksi yang menyertai tiap potongan.
  const target = Math.floor(budget * 0.85);

  const chunks = [];
  let acc = [];
  let accWords = 0;
  let spanStart = null;

  const flush = () => {
    if (!acc.length) return;
    chunks.push({
      level: 1,
      index: chunks.length + 1,
      chapter_span: [spanStart, acc[acc.length - 1].chapter],
      scene_count: acc.length,
      word_count: accWords,
      // Rangkaian penanda posisi membantu AI menilai perkembangan cerita.
      position: positionLabel(spanStart - 1, preprocessed.chapters.length),
      content: acc.map(s =>
        `[BAB ${s.chapter}${s.chapter_title ? ` — ${s.chapter_title}` : ''} | ADEGAN ${s.scene}/${s.scene_total}]\n${s.content}`
      ).join('\n\n'),
      scenes: acc.map(s => ({
        chapter: s.chapter,
        scene: s.scene,
        word_count: s.word_count,
        dialogue_ratio: s.dialogue_ratio
      }))
    });
    acc = [];
    accWords = 0;
    spanStart = null;
  };

  for (const ch of preprocessed.chapters) {
    for (const sc of ch.scenes) {
      const units = sc.word_count > target
        ? splitOnParagraphs(sc.content, target).map((content, i, all) => ({
            content,
            word_count: content.split(/\s+/).filter(Boolean).length,
            partOf: `${i + 1}/${all.length}`
          }))
        : [{ content: sc.content, word_count: sc.word_count }];

      for (const unit of units) {
        if (accWords + unit.word_count > target && acc.length) flush();
        if (spanStart === null) spanStart = ch.number;
        acc.push({
          chapter: ch.number,
          chapter_title: ch.title_detected ? ch.title : null,
          scene: sc.number,
          scene_total: ch.scenes.length,
          content: unit.content,
          word_count: unit.word_count,
          dialogue_ratio: sc.dialogue_ratio
        });
        accWords += unit.word_count;
      }
    }
  }
  flush();

  return chunks;
}

/**
 * LEVEL 2 — kelompok bab.
 *
 * Hasil analisis Level 1 dikelompokkan per babak cerita agar AI bisa
 * menilai perkembangan (pacing, eskalasi konflik) antar bagian novel,
 * bukan hanya potongan lepas.
 */
function buildChapterGroups(preprocessed, maxGroups = 5) {
  const chapters = preprocessed.chapters;
  if (chapters.length === 0) return [];

  const groupCount = Math.min(maxGroups, Math.max(1, Math.ceil(chapters.length / 4)));
  const perGroup = Math.ceil(chapters.length / groupCount);
  const groups = [];

  for (let i = 0; i < chapters.length; i += perGroup) {
    const slice = chapters.slice(i, i + perGroup);
    groups.push({
      level: 2,
      index: groups.length + 1,
      chapter_span: [slice[0].number, slice[slice.length - 1].number],
      position: positionLabel(groups.length, groupCount),
      chapter_count: slice.length,
      word_count: slice.reduce((a, c) => a + c.word_count, 0),
      chapters: slice.map(c => ({
        number: c.number,
        title: c.title,
        word_count: c.word_count,
        scene_count: c.scenes.length,
        dialogue_ratio: c.metrics.dialogue_ratio,
        // Pembuka dan penutup bab adalah tempat hook & cliffhanger berada,
        // jadi dua bagian ini selalu ikut walau isi bab tidak.
        opening: c.content.slice(0, 700),
        closing: c.content.slice(-700)
      }))
    });
  }

  return groups;
}

/**
 * Ringkasan struktural seluruh novel untuk analisis Level 3.
 * Berisi angka-angka terukur, bukan teks mentah, sehingga muat di
 * satu panggilan berapa pun besar novelnya.
 */
function buildNovelOverview(preprocessed) {
  const chapters = preprocessed.chapters;
  return {
    level: 3,
    total_chapters: chapters.length,
    total_scenes: preprocessed.stats.scene_count,
    total_words: preprocessed.metrics.word_count,
    avg_chapter_words: preprocessed.stats.avg_chapter_words,
    chapter_titles: chapters.slice(0, 60).map(c => c.title),
    chapters_with_real_titles: preprocessed.stats.chapters_with_detected_titles,
    // Kurva panjang bab dan rasio dialog per bab = sidik jari pacing.
    chapter_word_curve: chapters.map(c => c.word_count),
    chapter_dialogue_curve: chapters.map(c => c.metrics.dialogue_ratio),
    global_metrics: preprocessed.metrics,
    fingerprint: preprocessed.fingerprint
  };
}

/**
 * Membangun seluruh rencana pemotongan tiga tingkat sekaligus,
 * lengkap dengan perkiraan jumlah panggilan AI yang dibutuhkan.
 */
function buildChunkPlan(preprocessed, modelName, opts = {}) {
  const level1 = buildSceneChunks(preprocessed, modelName, opts);
  const level2 = buildChapterGroups(preprocessed, opts.maxGroups || 5);
  const level3 = buildNovelOverview(preprocessed);

  return {
    level1,
    level2,
    level3,
    plan: {
      model: modelName,
      max_words_per_call: opts.maxWords || maxWordsPerCall(modelName),
      level1_chunks: level1.length,
      level2_groups: level2.length,
      // Level 1 + Level 2 + sintesis Level 3 + ekstraksi kategori DNA.
      estimated_calls: level1.length + level2.length + 1,
      coverage_words: level1.reduce((a, c) => a + c.word_count, 0),
      total_words: preprocessed.metrics.word_count
    }
  };
}

module.exports = {
  positionLabel,
  splitOnParagraphs,
  buildSceneChunks,
  buildChapterGroups,
  buildNovelOverview,
  buildChunkPlan
};
