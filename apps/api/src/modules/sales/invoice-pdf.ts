import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  amountInWords,
  formatINR,
  getStateName,
  hsnSummary,
  PAYMENT_METHOD_LABELS,
  type SaleDto,
  type SettingsDto,
} from '@ims/shared';
import PDFDocument from 'pdfkit';

/** Finds assets/fonts both from the source tree (tsx) and from the bundled build (dist). */
function fontDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'assets', 'fonts');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Invoice fonts not found (expected apps/api/assets/fonts)');
}
const FONTS = fontDir();

const PAGE = { width: 595.28, height: 841.89, margin: 36 };
const INK = '#0f172a';
const MUTED = '#475569';
const RULE = '#cbd5e1';
const HEAD_FILL = '#f1f5f9';

const dateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});
const qty = (n: number) => Number(n.toFixed(3)).toLocaleString('en-IN');
const money = (paise: number) => formatINR(paise).replace('₹', '');
const stateLabel = (code: string) => `${getStateName(code) ?? 'State'} (${code})`;

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * A GST tax invoice as a PDF: the shop's and buyer's details, place of supply, each line with
 * its HSN code and tax, totals with round-off and the amount in words, and the HSN-wise tax
 * summary. CGST + SGST for sales within the state, IGST across states.
 */
export function renderInvoicePdf(sale: SaleDto, shop: SettingsDto): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    info: {
      Title: `Tax invoice ${sale.invoiceNumber}`,
      Author: shop.legalName ?? shop.shopName,
      Subject: `Invoice ${sale.invoiceNumber} for ${formatINR(sale.grandTotal)}`,
    },
  });
  doc.registerFont('regular', join(FONTS, 'Inter-Regular.otf'));
  doc.registerFont('bold', join(FONTS, 'Inter-SemiBold.otf'));

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const width = right - left;
  const bottom = PAGE.height - PAGE.margin - 24;
  const text = (
    value: string,
    x: number,
    y: number,
    opts: PDFKit.Mixins.TextOptions & {
      font?: 'regular' | 'bold';
      size?: number;
      color?: string;
    } = {},
  ) => {
    const { font = 'regular', size = 9, color = INK, ...rest } = opts;
    doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(value, x, y, { lineGap: 1.5, ...rest });
    return doc.y;
  };
  const hr = (y: number, color = RULE) => {
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor(color).stroke();
  };

  // --- Header: seller --------------------------------------------------------------------
  let y = PAGE.margin;
  text('TAX INVOICE', left, y, { font: 'bold', size: 15, width, align: 'right' });
  text('Original for recipient', left, y + 20, { size: 8, color: MUTED, width, align: 'right' });
  text(shop.shopName, left, y, { font: 'bold', size: 15, width: width * 0.6 });
  const sellerLines = [
    shop.legalName && shop.legalName !== shop.shopName ? shop.legalName : undefined,
    [shop.address?.line1, shop.address?.line2].filter(Boolean).join(', ') || undefined,
    [shop.address?.city, shop.address?.pincode].filter(Boolean).join(' – ') || undefined,
    [shop.phone && `Phone ${shop.phone}`, shop.email].filter(Boolean).join(' · ') || undefined,
  ].filter((l): l is string => Boolean(l));
  y = doc.y + 2;
  for (const line of sellerLines) y = text(line, left, y, { color: MUTED, width: width * 0.6 });
  y = text(`GSTIN ${shop.gstin} · State ${stateLabel(shop.stateCode)}`, left, y + 2, {
    font: 'bold',
    width: width * 0.7,
  });
  y += 8;
  hr(y, INK);

  // --- Buyer and invoice details -----------------------------------------------------------
  y += 10;
  const half = width / 2;
  const top = y;
  text('Bill to', left, y, { size: 8, color: MUTED });
  y = text(sale.customer?.name ?? 'Walk-in customer', left, doc.y + 1, {
    font: 'bold',
    size: 10,
    width: half - 12,
  });
  const buyer = [
    sale.customer?.phone && `Phone ${sale.customer.phone}`,
    sale.customer?.gstin && `GSTIN ${sale.customer.gstin}`,
    sale.customer?.stateCode && `State ${stateLabel(sale.customer.stateCode)}`,
  ].filter((l): l is string => Boolean(l));
  for (const line of buyer) y = text(line, left, y, { color: MUTED, width: half - 12 });
  const leftBottom = y;

  const details: [string, string][] = [
    ['Invoice no.', sale.invoiceNumber],
    ['Date', dateTime.format(new Date(sale.soldAt))],
    ['Place of supply', stateLabel(sale.placeOfSupply)],
    ['Cashier', sale.cashier.name],
  ];
  let dy = top;
  for (const [label, value] of details) {
    text(label, left + half, dy, { color: MUTED, width: 90 });
    dy = text(value, left + half + 90, dy, { font: 'bold', width: half - 90, align: 'right' });
  }
  y = Math.max(leftBottom, dy) + 10;

  // --- Line items --------------------------------------------------------------------------
  const taxCols: Column[] = sale.interState
    ? [{ label: 'IGST', width: 62, align: 'right' }]
    : [
        { label: 'CGST', width: 50, align: 'right' },
        { label: 'SGST', width: 50, align: 'right' },
      ];
  const fixed: Column[] = [
    { label: '#', width: 16, align: 'center' },
    { label: 'Item', width: 0 },
    { label: 'HSN', width: 38 },
    { label: 'Qty', width: 44, align: 'right' },
    { label: 'Price', width: 52, align: 'right' },
    { label: 'Disc.', width: 40, align: 'right' },
    { label: 'Taxable', width: 56, align: 'right' },
    ...taxCols,
    { label: 'Amount', width: 58, align: 'right' },
  ];
  fixed[1]!.width = width - fixed.reduce((sum, c) => sum + c.width, 0);
  const pad = 3;

  const drawRow = (cells: string[], opts: { header?: boolean; font?: 'regular' | 'bold' } = {}) => {
    const font = opts.header ? 'bold' : (opts.font ?? 'regular');
    doc.font(font).fontSize(8);
    const height =
      Math.max(
        ...cells.map((c, i) => doc.heightOfString(c, { width: fixed[i]!.width - pad * 2 })),
      ) +
      pad * 2;
    if (y + height > bottom) {
      doc.addPage();
      y = PAGE.margin;
      if (!opts.header) drawHeader();
    }
    if (opts.header) doc.rect(left, y, width, height).fill(HEAD_FILL);
    let x = left;
    cells.forEach((c, i) => {
      const col = fixed[i]!;
      text(c, x + pad, y + pad, {
        font,
        size: 8,
        width: col.width - pad * 2,
        align: col.align ?? 'left',
        color: opts.header ? MUTED : INK,
      });
      x += col.width;
    });
    y += height;
    hr(y);
  };
  const drawHeader = () =>
    drawRow(
      fixed.map((c) => c.label),
      { header: true },
    );

  drawHeader();
  sale.items.forEach((item, index) => {
    const tax = sale.interState
      ? [`${money(item.igst)}\n${item.gstRate}%`]
      : [`${money(item.cgst)}\n${item.gstRate / 2}%`, `${money(item.sgst)}\n${item.gstRate / 2}%`];
    drawRow([
      String(index + 1),
      `${item.product.name}\n${item.product.sku}`,
      item.hsnCode,
      `${qty(item.quantity)} ${item.product.unit}`,
      money(item.unitPrice),
      item.discount ? money(item.discount) : '–',
      money(item.taxable),
      ...tax,
      money(item.total),
    ]);
  });

  // --- Totals ------------------------------------------------------------------------------
  const totals: [string, number][] = [
    ['Total before discount', sale.gross],
    ...(sale.discount ? ([['Discount', -sale.discount]] as [string, number][]) : []),
    ['Taxable value', sale.taxable],
    ...((sale.interState
      ? [['IGST', sale.igst]]
      : [
          ['CGST', sale.cgst],
          ['SGST', sale.sgst],
        ]) as [string, number][]),
    ['Round off', sale.roundOff],
  ];
  const boxWidth = 210;
  const boxLeft = right - boxWidth;
  if (y + 14 * totals.length + 70 > bottom) {
    doc.addPage();
    y = PAGE.margin;
  }
  y += 8;
  const totalsTop = y;
  for (const [label, value] of totals) {
    text(label, boxLeft, y, { color: MUTED, width: 120 });
    y = text(value < 0 ? `−${money(-value)}` : money(value), boxLeft + 120, y, {
      width: boxWidth - 120,
      align: 'right',
    });
  }
  y += 3;
  doc.moveTo(boxLeft, y).lineTo(right, y).lineWidth(0.8).strokeColor(INK).stroke();
  y += 5;
  text('Total', boxLeft, y, { font: 'bold', size: 12, width: 100 });
  y = text(formatINR(sale.grandTotal), boxLeft + 90, y, {
    font: 'bold',
    size: 12,
    width: boxWidth - 90,
    align: 'right',
  });

  const words = boxLeft - left - 16;
  let wy = totalsTop;
  text('Amount in words', left, wy, { size: 8, color: MUTED });
  wy = text(amountInWords(sale.grandTotal), left, doc.y + 1, { font: 'bold', width: words });
  wy = text('Paid by', left, wy + 8, { size: 8, color: MUTED });
  for (const p of sale.payments) {
    wy = text(
      `${PAYMENT_METHOD_LABELS[p.method]} ${formatINR(p.amount)}${p.reference ? ` (ref. ${p.reference})` : ''}`,
      left,
      wy + 1,
      { width: words },
    );
  }
  y = Math.max(y, wy) + 16;

  // --- HSN-wise tax summary ----------------------------------------------------------------
  const summary = hsnSummary(sale.items);
  const sumCols: Column[] = [
    { label: 'HSN', width: 70 },
    { label: 'GST rate', width: 60, align: 'right' },
    { label: 'Taxable value', width: 100, align: 'right' },
    ...(sale.interState
      ? [{ label: 'IGST', width: 100, align: 'right' as const }]
      : [
          { label: 'CGST', width: 90, align: 'right' as const },
          { label: 'SGST', width: 90, align: 'right' as const },
        ]),
    { label: 'Total tax', width: 0, align: 'right' },
  ];
  sumCols[sumCols.length - 1]!.width = width - sumCols.reduce((s, c) => s + c.width, 0);
  const rowH = 15;
  if (y + rowH * (summary.length + 3) > bottom) {
    doc.addPage();
    y = PAGE.margin;
  }
  y = text('Tax summary by HSN', left, y, { font: 'bold', size: 9 }) + 3;
  const sumRow = (cells: string[], header = false) => {
    if (header) doc.rect(left, y, width, rowH).fill(HEAD_FILL);
    let x = left;
    cells.forEach((c, i) => {
      text(c, x + pad, y + 3.5, {
        font: header ? 'bold' : 'regular',
        size: 8,
        width: sumCols[i]!.width - pad * 2,
        align: sumCols[i]!.align ?? 'left',
        color: header ? MUTED : INK,
      });
      x += sumCols[i]!.width;
    });
    y += rowH;
    hr(y);
  };
  sumRow(
    sumCols.map((c) => c.label),
    true,
  );
  for (const g of summary) {
    sumRow([
      g.hsnCode,
      `${g.gstRate}%`,
      money(g.taxable),
      ...(sale.interState ? [money(g.igst)] : [money(g.cgst), money(g.sgst)]),
      money(g.cgst + g.sgst + g.igst),
    ]);
  }
  sumRow([
    'Total',
    '',
    money(sale.taxable),
    ...(sale.interState ? [money(sale.igst)] : [money(sale.cgst), money(sale.sgst)]),
    money(sale.totalTax),
  ]);

  // --- Footer ------------------------------------------------------------------------------
  if (y + 70 > bottom) {
    doc.addPage();
    y = PAGE.margin;
  }
  y += 18;
  if (shop.invoiceFooter) y = text(shop.invoiceFooter, left, y, { width: width * 0.6 }) + 4;
  if (sale.notes) y = text(`Note: ${sale.notes}`, left, y, { width: width * 0.6, color: MUTED });
  text(`For ${shop.legalName ?? shop.shopName}`, left, y + 6, {
    font: 'bold',
    width,
    align: 'right',
  });
  text('Authorised signatory', left, y + 40, { size: 8, color: MUTED, width, align: 'right' });
  text('This is a computer-generated invoice.', left, y + 40, { size: 8, color: MUTED });

  doc.end();
  return done;
}
