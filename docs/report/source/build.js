// Builds the project report (.docx). Usage: node build.js out.docx [pages.json]
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, Header, Footer, PageNumber, NumberFormat, TabStopType, LevelFormat,
  PageBorderDisplay, PageBorderOffsetFrom, VerticalAlign, HeightRule, TableLayoutType,
} = require('docx');
const content = require('./content.js');
if (process.env.REPORT_UPTO === 'methodology') require('./first-review.js')(content);
const { papers } = require('./literature.js');

const [, , OUT, PAGES] = process.argv;
const pages = PAGES && fs.existsSync(PAGES) ? JSON.parse(fs.readFileSync(PAGES, 'utf8')) : {};
const pg = (key) => pages[key] ?? '00';
const M = content.meta;

// ---------- page geometry (A4, DXA) ----------
const PAGE_W = 11906, PAGE_H = 16838;
const MARGIN = { top: 1440, bottom: 1300, left: 1800, right: 1260, header: 600, footer: 560 };
const TEXT_W = PAGE_W - MARGIN.left - MARGIN.right; // 8846
const IN = 1440;
const FONT = 'Times New Roman';
const COLORS = { purple: '7030A0', red: 'C00000', green: '00863D', navy: '1F3864', blue: '0070C0', black: '000000' };

// ---------- helpers ----------
function runs(text, base = {}) {
  const out = [];
  for (const part of String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)) {
    if (!part) continue;
    if (part.startsWith('**')) out.push(new TextRun({ ...base, text: part.slice(2, -2), bold: true }));
    else if (part.startsWith('*') && part.length > 2) out.push(new TextRun({ ...base, text: part.slice(1, -1), italics: true }));
    else out.push(new TextRun({ ...base, text: part }));
  }
  return out;
}
const placeholder = (text, base = {}) =>
  new TextRun({ ...base, text, ...(text.includes('___') && { highlight: 'yellow' }) });

function para(text, opts = {}) {
  const { indent = true, align = AlignmentType.JUSTIFIED, size = 24, after = 140, line = 360, keepNext, base = {}, before = 0 } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { line, after, before },
    indent: indent ? { firstLine: 720 } : undefined,
    keepNext,
    children: runs(text, { size, font: FONT, ...base }),
  });
}
function center(text, size, color, opts = {}) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: opts.after ?? 40, before: opts.before ?? 0, line: opts.line ?? 260 },
    keepNext: opts.keepNext,
    children: (Array.isArray(text) ? text : [text]).map((t) =>
      typeof t === 'string'
        ? new TextRun({ text: t, size, bold: opts.bold ?? true, color, font: FONT, underline: opts.underline ? {} : undefined, italics: opts.italics })
        : t,
    ),
  });
}
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b };
}
function image(file, widthIn, maxHeightIn = 7.6) {
  const { w, h, data } = pngSize(file);
  let wi = widthIn, hi = (widthIn * h) / w;
  if (hi > maxHeightIn) { hi = maxHeightIn; wi = (hi * w) / h; }
  return new ImageRun({ type: 'png', data, transformation: { width: Math.round(wi * 96), height: Math.round(hi * 96) } });
}
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };

// ---------- numbering (each list restarts) ----------
let listInstance = 0;
const numberingConfig = [
  { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
  { reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
];
function list(items, ordered = true) {
  const instance = ++listInstance;
  return items.map((t) => new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 360, after: 80 },
    numbering: { reference: ordered ? 'num' : 'bul', level: 0, instance },
    children: runs(t, { size: 24, font: FONT }),
  }));
}

// ---------- registries for contents / figures / tables ----------
const toc = [], figs = [], tabs = [];
let chapterNo = 0, figNo = {}, tabNo = {};

function caption(text) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 240, line: 276 }, children: [new TextRun({ text, bold: true, size: 24, font: FONT })] });
}
function figure(key, file, title, widthIn) {
  const n = (figNo[chapterNo] = (figNo[chapterNo] ?? 0) + 1);
  const label = `Fig ${chapterNo}.${n}`;
  figs.push({ key, label, title });
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 0 }, children: [image(file, widthIn)] }),
    caption(`${label}: ${title}`),
  ];
}
function cellParas(text, { bold = false, align = AlignmentType.LEFT, size = 22 } = {}) {
  return [new Paragraph({ alignment: align, spacing: { line: 264, before: 30, after: 30 }, children: runs(text, { size, font: FONT, bold }) })];
}
function table(key, title, widthsIn, header, rows) {
  const n = (tabNo[chapterNo] = (tabNo[chapterNo] ?? 0) + 1);
  const label = `Table ${chapterNo}.${n}`;
  tabs.push({ key, label, title });
  const total = widthsIn.reduce((a, b) => a + b, 0);
  const widths = widthsIn.map((w) => Math.round((w / total) * TEXT_W));
  widths[widths.length - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const centered = (i, t) => widthsIn.length >= 4 && i > 0 && String(t).length <= 6;
  const mk = (cells, isHeader) => new TableRow({
    tableHeader: isHeader,
    cantSplit: true,
    children: cells.map((t, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      borders,
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 40, bottom: 40, left: 90, right: 90 },
      shading: isHeader ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7E6E6' } : undefined,
      children: cellParas(t, { bold: isHeader, align: isHeader || centered(i, t) ? AlignmentType.CENTER : AlignmentType.LEFT }),
    })),
  });
  return [
    new Paragraph({ keepNext: true, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: `${label}: ${title}`, bold: true, size: 24, font: FONT })] }),
    new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: [mk(header, true), ...rows.map((r) => mk(r, false))] }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
}
function h2(num, title) {
  toc.push({ type: 'section', key: `s${num}`, label: `${num} ${title}`, num, title });
  return new Paragraph({ keepNext: true, spacing: { before: 240, after: 160 }, children: [new TextRun({ text: `${num} ${title}`, bold: true, size: 28, font: FONT })] });
}
function h3(text) {
  return new Paragraph({ keepNext: true, spacing: { before: 160, after: 100 }, children: [new TextRun({ text, bold: true, size: 24, font: FONT })] });
}
function chapterHead(n, title) {
  toc.push({ type: 'chapter', key: `c${n}`, n, title });
  return [
    new Paragraph({ pageBreakBefore: n > 1, spacing: { after: 60 }, children: [new TextRun({ text: `CHAPTER ${n}`, bold: true, size: 32, font: FONT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: title, bold: true, size: 32, font: FONT })] }),
  ];
}

// ---------- body ----------
const body = [];
content.chapters.forEach((ch, i) => {
  chapterNo = i + 1;
  body.push(...chapterHead(chapterNo, ch.title));
  if (ch.literature) {
    for (const p of papers) {
      body.push(para(p.lead + ' ' + p.text, { indent: false, after: 220 }));
    }
  }
  for (const b of ch.blocks) {
    const [kind, ...a] = b;
    if (kind === 'p') body.push(para(a[0]));
    else if (kind === 'np') body.push(para(a[0], { indent: false }));
    else if (kind === 'h2') body.push(h2(a[0], a[1]));
    else if (kind === 'h3') body.push(h3(a[0]));
    else if (kind === 'ol') body.push(...list(a[0], true));
    else if (kind === 'ul') body.push(...list(a[0], false));
    else if (kind === 'fig') body.push(...figure(a[0], a[1], a[2], a[3]));
    else if (kind === 'table') body.push(...table(a[0], a[1], a[2], a[3], a[4]));
    else if (kind === 'eq') body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80, line: 300 }, children: [new TextRun({ text: a[0], italics: true, size: 24, font: FONT })] }));
    else throw new Error('unknown block ' + kind);
  }
});
// references
toc.push({ type: 'refs', key: 'refs', title: 'REFERENCES' });
body.push(new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: 'REFERENCES', bold: true, size: 32, font: FONT })] }));
papers.forEach((p, i) => body.push(new Paragraph({
  alignment: AlignmentType.JUSTIFIED, spacing: { line: 330, after: 140 }, indent: { left: 540, hanging: 540 },
  children: [new TextRun({ text: `[${i + 1}]\t`, size: 24, font: FONT }), ...runs(p.ref, { size: 24, font: FONT })],
  tabStops: [{ type: TabStopType.LEFT, position: 540 }],
})));

// ---------- header / footer ----------
const ruleBelow = { bottom: { style: BorderStyle.THICK_THIN_SMALL_GAP, size: 18, color: '000000', space: 4 } };
const ruleAbove = { top: { style: BorderStyle.THIN_THICK_SMALL_GAP, size: 18, color: '000000', space: 4 } };
const mainHeader = new Header({ children: [new Paragraph({
  border: ruleBelow, tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }], spacing: { after: 0 },
  children: [new TextRun({ text: `“${M.title}”`, italics: true, size: 22, font: FONT }), new TextRun({ text: `\t${M.year}`, italics: true, size: 22, font: FONT })],
})] });
const mainFooter = new Footer({ children: [new Paragraph({
  border: ruleAbove, tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
  children: [new TextRun({ text: 'Dept Of CSE [AI & ML], Dr. T. TTIT, KGF', italics: true, size: 22, font: FONT }), new TextRun({ children: ['\t', PageNumber.CURRENT], italics: true, size: 22, font: FONT })],
})] });
const romanFooter = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 22, font: FONT })] })] });

// ---------- cover, certificate, declaration ----------
const LOGO_VTU = path.join(__dirname, 'logos/vtu.png');
const LOGO_TTIT = path.join(__dirname, 'logos/ttit.png');
const imgPara = (file, wIn, after = 60) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after, before: 40 }, children: [image(file, wIn)] });

function membersTable(nameColor = COLORS.navy, size = 24) {
  const w = [3300, 500, 2200];
  return new Table({
    alignment: AlignmentType.CENTER, width: { size: 6000, type: WidthType.DXA }, columnWidths: w, borders: NO_BORDERS, layout: TableLayoutType.FIXED,
    rows: M.members.map(([n, u]) => new TableRow({ children: [n, '-', u].map((t, i) => new TableCell({
      width: { size: w[i], type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
      children: [new Paragraph({ alignment: i === 1 ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 20, line: 260 }, children: [placeholder(t, { bold: true, size, color: nameColor, font: FONT })] })],
    })) })),
  });
}
const cover = [
  center('VISVESVARAYA TECHNOLOGICAL UNIVERSITY', 32, COLORS.purple, { after: 0 }),
  center('BELAGAVI–590018', 24, COLORS.purple, { after: 0 }),
  center(M.year, 24, COLORS.purple, { after: 160 }),
  imgPara(LOGO_VTU, 1.35, 320),
  center('A Community Project Report', 28, COLORS.black, { bold: false, after: 20 }),
  center('On', 28, COLORS.black, { bold: false, after: 200 }),
  center(`“${M.title}”`, 32, COLORS.red, { after: 360 }),
  center(`Submitted in the partial fulfillment of the requirements for the 3rd Semester`, 23, COLORS.black, { bold: false, after: 20 }),
  center('A Community Project - 1BCP308 for the award of the degree of', 23, COLORS.black, { bold: false, after: 300 }),
  center('Bachelor of Engineering', 28, COLORS.green, { after: 0 }),
  center('In', 28, COLORS.green, { after: 0 }),
  center('Department of Computer Science and Engineering', 28, COLORS.green, { after: 0 }),
  center('(Artificial Intelligence and Machine Learning)', 28, COLORS.green, { after: 340 }),
  center('Submitted By', 26, COLORS.black, { bold: false, after: 120 }),
  membersTable(),
  imgPara(LOGO_TTIT, 1.4, 200),
  center('Under the Guidance of', 26, COLORS.black, { after: 60 }),
  center([placeholder(M.guide.name, { bold: true, size: 28, color: COLORS.red, font: FONT })], 28, COLORS.red, { after: 20 }),
  center(M.guide.designation, 23, COLORS.black, { bold: false, after: 0 }),
  center('Dept of CSE (AI & ML)', 23, COLORS.black, { bold: false, after: 0 }),
  center('Dr. TTIT, KGF', 23, COLORS.black, { bold: false, after: 360 }),
  center('Department of Computer Science and Engineering', 27, COLORS.red, { after: 0 }),
  center('(Artificial Intelligence and Machine Learning)', 27, COLORS.red, { after: 20 }),
  center('Dr. T. THIMMAIAH INSTITUTE OF TECHNOLOGY', 28, COLORS.navy, { after: 0 }),
  center('Oorgaum, Kolar Gold Fields 563120', 23, COLORS.navy, { after: 60 }),
  center("Accredited by NBA (CSE, MINING, ECE) and NAAC with 'A' Grade", 23, COLORS.black, { after: 0 }),
];

const memberList = M.members.map(([n, u]) => `${n}-${u}`);
const certRuns = (() => {
  const b = { size: 24, font: FONT };
  const r = [
    new TextRun({ ...b, text: 'This is to certify that the Community Project entitled ' }),
    new TextRun({ ...b, text: `“${M.title}”`, color: COLORS.red }),
    new TextRun({ ...b, text: ' is a bonafide work carried out by ' }),
  ];
  memberList.forEach((m, i) => {
    const [name, usn] = m.split('-');
    r.push(new TextRun({ ...b, text: name + '-', color: COLORS.navy }), placeholder(usn, { ...b, color: COLORS.navy }));
    r.push(new TextRun({ ...b, text: i < memberList.length - 1 ? ', ' : ' ' }));
  });
  r.push(
    new TextRun({ ...b, text: 'in the partial fulfillment for the completion of 3rd semester of Bachelor of Engineering in ' }),
    new TextRun({ ...b, text: 'Computer Science and Engineering (Artificial Intelligence and Machine Learning)', color: COLORS.red }),
    new TextRun({ ...b, text: ' of the ' }),
    new TextRun({ ...b, text: 'Visvesvaraya Technological University, Belagavi', color: COLORS.purple }),
    new TextRun({ ...b, text: ` during the academic year ${M.year}. It is certified that all corrections/suggestions indicated for the assessment have been incorporated in the Community Project Report deposited in the department library.` }),
  );
  return r;
})();
function sigTable() {
  const w = [Math.round(TEXT_W / 3), Math.round(TEXT_W / 3), TEXT_W - 2 * Math.round(TEXT_W / 3)];
  const col = (role, p, lines) => [
    { t: '……………………………', c: COLORS.black, b: false },
    { t: `Signature of ${role}`, c: COLORS.navy, b: true },
    { t: p.name, c: COLORS.red, b: true, ph: true },
    ...lines.map((l) => ({ t: l, c: COLORS.black, b: true })),
  ];
  const cols = [
    col('Guide', M.guide, [M.guide.designation === 'Assistant Professor' ? 'Asst. Prof.' : M.guide.designation, 'Dept. of CSE (AI & ML)', 'Dr. TTIT, KGF']),
    col('H.O.D', M.hod, [M.hod.designation, 'Dept. of CSE (AI & ML),', 'Dr. TTIT, KGF']),
    col('Principal', M.principal, [M.principal.designation, 'Dr. TTIT, KGF']),
  ];
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: w, borders: NO_BORDERS, layout: TableLayoutType.FIXED,
    rows: [new TableRow({ children: cols.map((c, i) => new TableCell({
      width: { size: w[i], type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
      children: c.map((l) => new Paragraph({ spacing: { after: 0, line: 250 }, children: [l.ph ? placeholder(l.t, { bold: l.b, size: 22, color: l.c, font: FONT }) : new TextRun({ text: l.t, bold: l.b, size: 22, color: l.c, font: FONT })] })),
    })) })],
  });
}
const certificate = [
  new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'DR. T. THIMMAIAH INSTITUTE OF TECHNOLOGY', bold: true, size: 32, color: COLORS.blue, font: FONT })] }),
  center('Oorgaum, K.G.F 563120', 23, COLORS.black, { bold: false, after: 20 }),
  center("Accredited by NBA (CSE, Mining, ECE) and NAAC with 'A' Grade", 23, COLORS.black, { bold: false, after: 60 }),
  imgPara(LOGO_TTIT, 1.45, 200),
  center('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING', 27, COLORS.black, { after: 40 }),
  center('(ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING)', 27, COLORS.black, { after: 360 }),
  center('CERTIFICATE', 30, COLORS.red, { bold: false, underline: true, after: 300 }),
  new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { line: 400, after: 160 }, indent: { firstLine: 500 }, children: certRuns }),
  para('The report has been approved as it satisfies the academic requirement in respect of Community Project Report – 1BCP308 prescribed for the Bachelor of Engineering Degree.', { indent: false, line: 400, after: 2600 }),
  sigTable(),
];

function declGrid() {
  const w = [Math.round(TEXT_W / 2), TEXT_W - Math.round(TEXT_W / 2)];
  const cell = ([n, u], i) => new TableCell({
    width: { size: w[i % 2], type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 700, after: 40 }, children: [new TextRun({ text: '……………………………………', bold: true, color: COLORS.navy, size: 24, font: FONT })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: n, bold: true, color: COLORS.navy, size: 24, font: FONT })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [placeholder(u, { bold: true, color: COLORS.navy, size: 24, font: FONT })] }),
    ],
  });
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: w, borders: NO_BORDERS, layout: TableLayoutType.FIXED,
    rows: [0, 2].map((k) => new TableRow({ children: [cell(M.members[k], 0), cell(M.members[k + 1], 1)] })),
  });
}
const declaration = [
  new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { before: 200, after: 400 }, children: [new TextRun({ text: 'DECLARATION', bold: true, size: 28, font: FONT })] }),
  para(`We here by declare that the Project work entitled **“${M.title}”** submitted to **Visvesvaraya Technological University**, Belagavi during the year **2026-27** in the partial fulfillment for the award of **Bachelor of Engineering** in **Computer Science and Engineering (Artificial Intelligence and Machine Learning)** is a record of bonafide work carried out by us under the supervision of `, { line: 400, after: 0 }),
];
// The guide's name sits inside the paragraph above; rebuild that paragraph with a highlighted placeholder run.
declaration[1] = new Paragraph({
  alignment: AlignmentType.JUSTIFIED, spacing: { line: 400, after: 200 }, indent: { firstLine: 720 },
  children: [
    ...runs(`We here by declare that the Project work entitled **“${M.title}”** submitted to **Visvesvaraya Technological University**, Belagavi during the year **2026-27** in the partial fulfillment for the award of **Bachelor of Engineering** in **Computer Science and Engineering (Artificial Intelligence and Machine Learning)** is a record of bonafide work carried out by us under the supervision of `, { size: 24, font: FONT }),
    placeholder(M.guide.name, { size: 24, font: FONT, bold: true }),
    ...runs(`**, Asst. Prof** Department of Computer Science and Engineering (Artificial Intelligence and Machine Learning), Dr. T Thimmaiah Institute of Technology – KGF.`, { size: 24, font: FONT }),
  ],
});
declaration.push(
  para('We further declare that the work reported in this Project report has not been submitted and will not be submitted, either in part or in full, for the award of any other degree or diploma in this institute or any other institute or university.', { indent: false, line: 400, after: 500 }),
  para('Place: KGF', { indent: false, after: 200 }),
  para('Date:', { indent: false, after: 400 }),
  para('**Signature of the Candidate**', { indent: false, after: 0 }),
  declGrid(),
);

// ---------- front matter: acknowledgement, abstract, contents, figures, tables ----------
const frontHead = (t) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: t, bold: true, size: 28, font: FONT })] });
const ackNames = new Table({
  alignment: AlignmentType.RIGHT, width: { size: 5600, type: WidthType.DXA }, columnWidths: [3000, 400, 2200], borders: NO_BORDERS, layout: TableLayoutType.FIXED,
  rows: M.members.map(([n, u]) => new TableRow({ children: [n, '-', u].map((t, i) => new TableCell({
    width: { size: [3000, 400, 2200][i], type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
    children: [new Paragraph({ alignment: i === 1 ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 60 }, children: [placeholder(t, { bold: true, size: 24, font: FONT })] })],
  })) })),
});
const ack = [
  frontHead('ACKNOWLEDGEMENT'),
  para('The successful completion of any task would be incomplete without the mention of the people who made it possible, whose constant guidance and encouragement crown effort with success.'),
  para('It is with the profound feeling of gratitude we would like to express our sincere thanks to our institution **Dr. T. THIMMAIAH INSTITUTE OF TECHNOLOGY, KGF,** for providing excellent infrastructure for successful completion of the Community Project.'),
  para(`We wish to express a whole hearted thanks to our Principal, **${M.principal.name}, Dr. TTIT, K.G.F,** for being a constant support in carrying out this project.`),
  para(`We would like to extend heartly thanks to our HOD, **${M.hod.name}, Associate Professor and Head, Dept. of CSE (AI & ML), Dr. TTIT, K.G.F,** for being a constant support of encouragement to carry out the Community Project successfully.`),
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED, spacing: { line: 360, after: 160 }, indent: { firstLine: 720 },
    children: [
      ...runs('We would like to extend hearty thanks to our guide ', { size: 24, font: FONT }),
      placeholder(M.guide.name, { size: 24, font: FONT, bold: true }),
      ...runs(`**, Asst. Professor** and our Coordinator **${M.coordinator}, Asst. Professor, Dept. of CSE (AI & ML), Dr. TTIT, K.G.F,** for their valuable suggestions, guidance and support in the completion of this Community Project work.`, { size: 24, font: FONT }),
    ],
  }),
  para('We would also like to thank all teaching and non-teaching staff of Dept. of CSE (AI&ML), Dr. TTIT, K.G.F who were directly and indirectly supported for carrying out this Community Project successfully.'),
  para('We extend our hearty thanks to our parents for what we are today and friends who helped us in successful completion of our Community Project report and for the betterment of our career.', { after: 300 }),
  ackNames,
];
const abstract = [
  new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: 'ABSTRACT', bold: true, size: 28, font: FONT })] }),
  ...content.abstract.map((t) => para(t, { indent: false, line: 340 })),
  para(`**Keywords:** ${content.keywords}`, { indent: false, line: 340, before: 120 }),
];

function borderlessTable(widths, rows, { headerBold = true } = {}) {
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths, borders: NO_BORDERS, layout: TableLayoutType.FIXED,
    rows: rows.map((r) => new TableRow({ cantSplit: true, children: r.cells.map((t, i) => new TableCell({
      columnSpan: r.span && i === 0 ? 2 : undefined,
      width: { size: r.span && i === 0 ? widths[0] + widths[1] : r.span ? widths[i + 1] : widths[i], type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
      children: [new Paragraph({
        alignment: i === r.cells.length - 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: r.gap ?? 60, after: 60, line: 260 },
        children: [new TextRun({ text: t, bold: r.bold?.[i] ?? false, size: r.size ?? 23, font: FONT })],
      })],
    })) })),
  });
}
const frontToc = [
  { label: 'ACKNOWLEDGEMENT', key: 'ack' }, { label: 'ABSTRACT', key: 'abstract' }, { label: 'CONTENTS', key: 'contents' },
  { label: 'LIST OF FIGURES', key: 'lof' }, { label: 'LIST OF TABLES', key: 'lot' },
];
function contentsPage() {
  const w = [2300, 5300, TEXT_W - 7600];
  const rows = [{ cells: ['DETAILS', 'PAGE NO'], bold: [true, true], span: true }];
  for (const f of frontToc) rows.push({ cells: [f.label, pg(f.key)], bold: [true, true], span: true });
  rows.push({ cells: ['CHAPTER NO.', 'DESCRIPTION', 'PAGE NO.'], bold: [true, true, true], gap: 200 });
  for (const e of toc) {
    if (e.type === 'chapter') rows.push({ cells: [`CHAPTER ${e.n}`, e.title, pg(e.key)], bold: [true, true, false], gap: 160 });
    else if (e.type === 'section') rows.push({ cells: ['', `${e.num} ${titleCase(e.title)}`, pg(e.key)] });
    else rows.push({ cells: ['', e.title, pg(e.key)], bold: [false, true, false], gap: 160 });
  }
  return [new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: 'TABLE OF CONTENTS', bold: true, size: 28, font: FONT })] }), borderlessTable(w, rows)];
}
function titleCase(s) {
  const small = new Set(['and', 'of', 'the', 'in', 'to', 'for', 'a', 'with']);
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
    .replace(/\bAi\b/g, 'AI').replace(/\bPos\b/g, 'POS');
}
function listPage(title, items, labelHead) {
  const w = [1500, TEXT_W - 1500 - 1100, 1100];
  const rows = [{ cells: ['SL. NO', 'DESCRIPTION', 'PAGE NO'], bold: [true, true, true] }];
  for (const it of items) rows.push({ cells: [it.label, it.title, pg(it.key)] });
  return [new Paragraph({ pageBreakBefore: true, alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: title, bold: true, size: 28, font: FONT })] }), borderlessTable(w, rows)];
}

// ---------- assemble ----------
const pageBorder = { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 24 };
const doc = new Document({
  creator: 'Project team',
  title: M.title,
  styles: { default: { document: { run: { font: FONT, size: 24 } } } },
  numbering: { config: numberingConfig },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: 1000, bottom: 900, left: 1300, right: 1300, header: 500, footer: 500 },
          borders: { pageBorderTop: pageBorder, pageBorderBottom: pageBorder, pageBorderLeft: pageBorder, pageBorderRight: pageBorder, pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE } },
        },
      },
      children: [...cover, ...certificate, ...declaration],
    },
    {
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: MARGIN, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } } },
      footers: { default: romanFooter },
      children: [...ack, ...abstract, ...contentsPage(), ...listPage('LIST OF FIGURES', figs), ...listPage('LIST OF TABLES', tabs)],
    },
    {
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: MARGIN, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
      headers: { default: mainHeader },
      footers: { default: mainFooter },
      children: body,
    },
  ],
});

// Markers used to find each entry's page in the rendered PDF.
const markers = {
  front: frontToc.map((f) => ({ key: f.key, text: f.key === 'contents' ? 'TABLE OF CONTENTS' : f.label })),
  body: [
    ...toc.map((e) => ({ key: e.key, text: e.type === 'chapter' ? `CHAPTER ${e.n}` : e.type === 'refs' ? 'REFERENCES' : `${e.num} ${e.title}` })),
    ...figs.map((f) => ({ key: f.key, text: `${f.label}:` })),
    ...tabs.map((t) => ({ key: t.key, text: `${t.label}:` })),
  ],
};
fs.writeFileSync(OUT.replace(/\.docx$/, '.markers.json'), JSON.stringify(markers, null, 1));
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log('wrote', OUT, figs.length, 'figures', tabs.length, 'tables'); });
