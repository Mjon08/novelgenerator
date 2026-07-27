/* ── novelGENerator Editor Export — Client-side .docx via docx library ─────────── */
/* Requires: docx (window.docx) via CDN, file-saver (window.saveAs)          */

async function eksporKeDocx(quill, dokumenId, judulDokumen) {
  if (!window.docx) {
    alert('Library docx belum dimuat. Coba lagi sebentar.');
    return;
  }

  const judul = judulDokumen || 'Novel';
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, Header, Footer, PageNumber, NumberFormat } = window.docx;

  // Ambil konten dari Quill
  const ops = quill.getContents().ops;
  const paragraphs = [];

  // Halaman judul
  paragraphs.push(
    new Paragraph({ text: '', spacing: { before: 3000 } }),
    new Paragraph({
      children: [new TextRun({ text: judul, bold: true, size: 36, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    new Paragraph({
      children: [new TextRun({ text: new Date().toLocaleDateString('id-ID', { year:'numeric',month:'long',day:'numeric' }), size: 22, font: 'Times New Roman', color: '666666' })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ children: [new PageBreak()] })
  );

  // Parse Quill ops ke paragraf docx
  let currentRuns = [];
  let currentAttrs = {};

  function flushParagraph(attrs = {}) {
    if (currentRuns.length === 0) return;
    const isHeading = attrs.header;
    let headingLevel = undefined;
    if (attrs.header === 1) headingLevel = HeadingLevel.HEADING_1;
    if (attrs.header === 2) headingLevel = HeadingLevel.HEADING_2;
    if (attrs.header === 3) headingLevel = HeadingLevel.HEADING_3;

    const para = new Paragraph({
      children: currentRuns,
      heading: headingLevel,
      alignment: attrs.align === 'center' ? AlignmentType.CENTER
        : attrs.align === 'right' ? AlignmentType.RIGHT
        : attrs.align === 'justify' ? AlignmentType.JUSTIFIED
        : AlignmentType.LEFT,
      indent: (!isHeading && attrs.align !== 'center') ? { firstLine: 720 } : undefined, // 1.5em ≈ 720 twips
      spacing: { line: 360, lineRule: 'auto', before: isHeading ? 240 : 0, after: isHeading ? 120 : 0 },
    });
    paragraphs.push(para);
    currentRuns = [];
  }

  let lineAttrs = {};
  for (const op of ops) {
    if (typeof op.insert === 'string') {
      const parts = op.insert.split('\n');
      for (let i = 0; i < parts.length; i++) {
        const text = parts[i];
        if (text) {
          const attrs = op.attributes || {};
          currentRuns.push(new TextRun({
            text,
            bold: !!attrs.bold,
            italics: !!attrs.italic,
            underline: attrs.underline ? {} : undefined,
            strike: !!attrs.strike,
            font: 'Times New Roman',
            size: 24, // 12pt = 24 half-points
          }));
        }
        if (i < parts.length - 1) {
          // newline — flush paragraph
          flushParagraph(lineAttrs);
          lineAttrs = op.attributes || {};
        }
      }
    }
  }
  flushParagraph(lineAttrs);

  const doc = new Document({
    numbering: { config: [] },
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1440 }, // 2.54cm top/bottom/right, 3cm left (in twips: 1cm ≈ 567 twips)
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: judul, font: 'Times New Roman', size: 20, color: '888888' })],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'Halaman ', font: 'Times New Roman', size: 18, color: '888888' }),
              new PageNumber({ size: 18 }),
            ],
            alignment: AlignmentType.CENTER,
          })],
        }),
      },
      children: paragraphs,
    }],
  });

  try {
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${judul.replace(/\s+/g, '_')}.docx`);
    if (typeof tampilToast === 'function') tampilToast('File .docx berhasil diunduh', 'success');
  } catch (err) {
    if (typeof tampilToast === 'function') tampilToast('Gagal ekspor .docx: ' + err.message, 'error');
    else alert('Gagal: ' + err.message);
  }
}
