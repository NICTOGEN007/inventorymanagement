import {
  formatINR,
  type ReportCell,
  type ReportColumn,
  type ReportDto,
  type ReportSection,
  type SettingsDto,
} from '@ims/shared';
import { createPdf, HEAD_FILL, INK, MUTED, PAGE } from '../../utils/pdf.js';

// ---------------------------------------------------------------------------
// CSV: one table, opened straight in Excel or Google Sheets.

/** Text a spreadsheet would run as a formula (=, +, -, @) gets a leading apostrophe. */
const FORMULA = /^[=+\-@\t\r]/;

function csvCell(value: ReportCell, type: ReportColumn['type']): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    // Money in rupees with paise, so a spreadsheet can add it up.
    return type === 'money' ? (value / 100).toFixed(2) : String(value);
  }
  const safe = FORMULA.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(section: ReportSection): string {
  const header = section.columns.map((c) =>
    csvCell(
      c.type === 'money' ? `${c.label} (₹)` : c.type === 'percent' ? `${c.label} (%)` : c.label,
      'text',
    ),
  );
  const line = (row: Record<string, ReportCell>) =>
    section.columns.map((c) => csvCell(row[c.key] ?? null, c.type)).join(',');
  const rows = [header.join(','), ...section.rows.map(line)];
  if (section.totals) rows.push(line(section.totals));
  // The byte-order mark makes Excel read the file (and the ₹ sign) as UTF-8.
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// PDF: every section of the report, landscape A4, with page numbers.

const cellText = (value: ReportCell, type: ReportColumn['type']) => {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'string') return value;
  if (type === 'money') {
    return value < 0 ? `−${formatINR(-value).replace('₹', '')}` : formatINR(value).replace('₹', '');
  }
  if (type === 'percent') return `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
};
const highlightText = (value: ReportCell, type: ReportColumn['type']) =>
  type === 'money' && typeof value === 'number'
    ? value < 0
      ? `−${formatINR(-value)}`
      : formatINR(value)
    : cellText(value, type);

const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export function renderReportPdf(report: ReportDto, shop: SettingsDto): Promise<Buffer> {
  const { doc, done, text, hr, layout } = createPdf(
    {
      Title: `${report.title}, ${report.subtitle}`,
      Author: shop.legalName ?? shop.shopName,
      Subject: report.title,
    },
    { landscape: true, bufferPages: true },
  );
  const { left, width, bottom } = layout;
  const pad = 3;
  let y = PAGE.margin;

  // --- Title -------------------------------------------------------------------------------
  text(shop.shopName, left, y, { font: 'bold', size: 10, color: MUTED, width: width / 2 });
  text(`GSTIN ${shop.gstin}`, left, y, { size: 8, color: MUTED, width, align: 'right' });
  y = text(report.title, left, y + 16, { font: 'bold', size: 16, width });
  y = text(report.subtitle, left, y + 1, { size: 9, color: MUTED, width });
  y += 10;

  // --- Highlights --------------------------------------------------------------------------
  const boxWidth = width / Math.max(report.highlights.length, 1);
  report.highlights.forEach((h, i) => {
    const x = left + i * boxWidth;
    text(h.label, x, y, { size: 7.5, color: MUTED, width: boxWidth - 8 });
    text(highlightText(h.value, h.type), x, y + 11, {
      font: 'bold',
      size: 11,
      width: boxWidth - 8,
      ellipsis: true,
      height: 14,
    });
  });
  y += 34;
  hr(y, INK);
  y += 12;

  // --- Sections ----------------------------------------------------------------------------
  const widthsFor = (columns: ReportColumn[]) => {
    const weight = (c: ReportColumn, i: number) =>
      c.type !== 'text' ? 1 : i === 0 ? 2.6 : c.key === 'unit' || c.key === 'type' ? 0.7 : 1.5;
    const weights = columns.map(weight);
    const total = weights.reduce((s, w) => s + w, 0);
    return weights.map((w) => (w / total) * width);
  };

  for (const section of report.sections) {
    const widths = widthsFor(section.columns);
    const align = (c: ReportColumn) => (c.type === 'text' ? 'left' : 'right');
    const rowHeight = (cells: string[], font: 'regular' | 'bold') => {
      doc.font(font).fontSize(7.5);
      return (
        Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i]! - pad * 2 }))) +
        pad * 2
      );
    };
    const drawRow = (cells: string[], kind: 'header' | 'row' | 'total') => {
      const font = kind === 'row' ? 'regular' : 'bold';
      const height = rowHeight(cells, font);
      if (y + height > bottom) {
        doc.addPage();
        y = PAGE.margin;
        if (kind !== 'header') drawHeader();
      }
      if (kind === 'header') doc.rect(left, y, width, height).fill(HEAD_FILL);
      if (kind === 'total') hr(y, INK);
      let x = left;
      cells.forEach((c, i) => {
        text(c, x + pad, y + pad, {
          font,
          size: 7.5,
          width: widths[i]! - pad * 2,
          align: align(section.columns[i]!),
          color: kind === 'header' ? MUTED : INK,
        });
        x += widths[i]!;
      });
      y += height;
      if (kind === 'row') hr(y);
    };
    const drawHeader = () =>
      drawRow(
        section.columns.map((c) => c.label),
        'header',
      );

    // Keep the title with at least the header and a couple of rows.
    if (y + 70 > bottom) {
      doc.addPage();
      y = PAGE.margin;
    }
    y = text(section.title, left, y, { font: 'bold', size: 11, width });
    if (section.description) {
      y = text(section.description, left, y + 1, { size: 7.5, color: MUTED, width });
    }
    y += 5;
    drawHeader();
    if (section.rows.length === 0) {
      y =
        text(section.empty ?? 'Nothing to show.', left + pad, y + 5, { size: 8, color: MUTED }) + 5;
    }
    for (const row of section.rows) {
      drawRow(
        section.columns.map((c) => cellText(row[c.key] ?? null, c.type)),
        'row',
      );
    }
    if (section.totals) {
      const totals = section.totals;
      drawRow(
        section.columns.map((c, i) =>
          totals[c.key] === undefined && i > 0 ? '' : cellText(totals[c.key] ?? null, c.type),
        ),
        'total',
      );
    }
    y += 18;
  }

  // --- Footer on every page ----------------------------------------------------------------
  const range = doc.bufferedPageRange();
  const generated = `Generated ${dateTime.format(new Date(report.generatedAt))}`;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // The footer sits in the bottom margin; without this pdfkit would start a new page for it.
    doc.page.margins.bottom = 0;
    const footerY = layout.pageHeight - PAGE.margin - 8;
    text(generated, left, footerY, { size: 7, color: MUTED, width, lineBreak: false });
    text(`Page ${i + 1} of ${range.count}`, left, footerY, {
      size: 7,
      color: MUTED,
      width,
      align: 'right',
      lineBreak: false,
    });
  }

  doc.end();
  return done;
}
