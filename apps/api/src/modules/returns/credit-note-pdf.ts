import {
  amountInWords,
  formatINR,
  hsnSummary,
  PAYMENT_METHOD_LABELS,
  type SaleReturnDto,
  type SettingsDto,
} from '@ims/shared';
import {
  createPdf,
  formatPdfDate,
  HEAD_FILL,
  INK,
  money,
  MUTED,
  PAGE,
  qty,
  stateLabel,
} from '../../utils/pdf.js';

interface Column {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * A GST credit note for goods taken back: the shop's and buyer's details, the original invoice
 * it reduces, each line with its HSN code and the tax reversed, the refund and the reason.
 */
export function renderCreditNotePdf(r: SaleReturnDto, shop: SettingsDto): Promise<Buffer> {
  const { doc, done, text, hr, layout } = createPdf({
    Title: `Credit note ${r.returnNumber}`,
    Author: shop.legalName ?? shop.shopName,
    Subject: `Credit note ${r.returnNumber} against invoice ${r.sale.invoiceNumber}`,
  });
  const { left, right, width, bottom } = layout;
  const pad = 3;

  // --- Header ------------------------------------------------------------------------------
  let y = PAGE.margin;
  text('CREDIT NOTE', left, y, { font: 'bold', size: 15, width, align: 'right' });
  text('Goods returned', left, y + 20, { size: 8, color: MUTED, width, align: 'right' });
  text(shop.shopName, left, y, { font: 'bold', size: 15, width: width * 0.6 });
  const sellerLines = [
    shop.legalName && shop.legalName !== shop.shopName ? shop.legalName : undefined,
    [shop.address?.line1, shop.address?.line2].filter(Boolean).join(', ') || undefined,
    [shop.address?.city, shop.address?.pincode].filter(Boolean).join(' – ') || undefined,
  ].filter((l): l is string => Boolean(l));
  y = doc.y + 2;
  for (const line of sellerLines) y = text(line, left, y, { color: MUTED, width: width * 0.6 });
  y = text(`GSTIN ${shop.gstin} · State ${stateLabel(shop.stateCode)}`, left, y + 2, {
    font: 'bold',
    width: width * 0.7,
  });
  y += 8;
  hr(y, INK);

  // --- Buyer and document details ----------------------------------------------------------
  y += 10;
  const half = width / 2;
  const top = y;
  text('Customer', left, y, { size: 8, color: MUTED });
  y = text(r.customer?.name ?? 'Walk-in customer', left, doc.y + 1, {
    font: 'bold',
    size: 10,
    width: half - 12,
  });
  const buyer = [
    r.customer?.phone && `Phone ${r.customer.phone}`,
    r.customer?.gstin && `GSTIN ${r.customer.gstin}`,
    r.customer?.stateCode && `State ${stateLabel(r.customer.stateCode)}`,
  ].filter((l): l is string => Boolean(l));
  for (const line of buyer) y = text(line, left, y, { color: MUTED, width: half - 12 });
  const leftBottom = y;

  const details: [string, string][] = [
    ['Credit note no.', r.returnNumber],
    ['Date', formatPdfDate(r.returnedAt)],
    ['Against invoice', r.sale.invoiceNumber],
    ['Invoice date', formatPdfDate(r.soldAt)],
    ['Place of supply', stateLabel(r.placeOfSupply)],
  ];
  let dy = top;
  for (const [label, value] of details) {
    text(label, left + half, dy, { color: MUTED, width: 90 });
    dy = text(value, left + half + 90, dy, { font: 'bold', width: half - 90, align: 'right' });
  }
  y = Math.max(leftBottom, dy) + 10;

  // --- Lines -------------------------------------------------------------------------------
  const taxCols: Column[] = r.interState
    ? [{ label: 'IGST', width: 66, align: 'right' }]
    : [
        { label: 'CGST', width: 56, align: 'right' },
        { label: 'SGST', width: 56, align: 'right' },
      ];
  const cols: Column[] = [
    { label: '#', width: 16, align: 'center' },
    { label: 'Item', width: 0 },
    { label: 'HSN', width: 44 },
    { label: 'Qty', width: 50, align: 'right' },
    { label: 'Taxable', width: 64, align: 'right' },
    ...taxCols,
    { label: 'Amount', width: 64, align: 'right' },
  ];
  cols[1]!.width = width - cols.reduce((sum, c) => sum + c.width, 0);

  const drawRow = (cells: string[], header = false) => {
    const font = header ? 'bold' : 'regular';
    doc.font(font).fontSize(8);
    const height =
      Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i]!.width - pad * 2 }))) +
      pad * 2;
    if (y + height > bottom) {
      doc.addPage();
      y = PAGE.margin;
      if (!header) drawHeader();
    }
    if (header) doc.rect(left, y, width, height).fill(HEAD_FILL);
    let x = left;
    cells.forEach((c, i) => {
      text(c, x + pad, y + pad, {
        font,
        size: 8,
        width: cols[i]!.width - pad * 2,
        align: cols[i]!.align ?? 'left',
        color: header ? MUTED : INK,
      });
      x += cols[i]!.width;
    });
    y += height;
    hr(y);
  };
  const drawHeader = () =>
    drawRow(
      cols.map((c) => c.label),
      true,
    );

  drawHeader();
  r.items.forEach((item, index) => {
    const tax = r.interState
      ? [`${money(item.igst)}\n${item.gstRate}%`]
      : [`${money(item.cgst)}\n${item.gstRate / 2}%`, `${money(item.sgst)}\n${item.gstRate / 2}%`];
    drawRow([
      String(index + 1),
      `${item.product.name}\n${item.product.sku}${item.restock ? '' : ' · not restocked'}`,
      item.hsnCode,
      `${qty(item.quantity)} ${item.product.unit}`,
      money(item.taxable),
      ...tax,
      money(item.total),
    ]);
  });

  // --- Totals ------------------------------------------------------------------------------
  const totals: [string, number][] = [
    ['Taxable value', r.taxable],
    ...((r.interState
      ? [['IGST', r.igst]]
      : [
          ['CGST', r.cgst],
          ['SGST', r.sgst],
        ]) as [string, number][]),
    ['Round off', r.roundOff],
  ];
  const boxWidth = 210;
  const boxLeft = right - boxWidth;
  if (y + 14 * totals.length + 90 > bottom) {
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
  text('Refund', boxLeft, y, { font: 'bold', size: 12, width: 100 });
  y = text(formatINR(r.totalRefund), boxLeft + 90, y, {
    font: 'bold',
    size: 12,
    width: boxWidth - 90,
    align: 'right',
  });

  const words = boxLeft - left - 16;
  let wy = totalsTop;
  text('Amount in words', left, wy, { size: 8, color: MUTED });
  wy = text(amountInWords(r.totalRefund), left, doc.y + 1, { font: 'bold', width: words });
  wy = text('Refunded by', left, wy + 8, { size: 8, color: MUTED });
  wy = text(
    `${PAYMENT_METHOD_LABELS[r.refundMethod]}${r.refundReference ? ` (ref. ${r.refundReference})` : ''}`,
    left,
    wy + 1,
    { width: words },
  );
  wy = text('Reason', left, wy + 8, { size: 8, color: MUTED });
  wy = text(r.reason, left, wy + 1, { width: words });
  y = Math.max(y, wy) + 16;

  // --- Tax reversed by HSN -----------------------------------------------------------------
  const summary = hsnSummary(r.items);
  const rowH = 15;
  if (y + rowH * (summary.length + 3) + 70 > bottom) {
    doc.addPage();
    y = PAGE.margin;
  }
  const sumCols: Column[] = [
    { label: 'HSN', width: 70 },
    { label: 'GST rate', width: 60, align: 'right' },
    { label: 'Taxable value', width: 100, align: 'right' },
    { label: 'Tax reversed', width: 0, align: 'right' },
  ];
  sumCols[3]!.width = width - sumCols.reduce((s, c) => s + c.width, 0);
  y = text('Tax reversed by HSN', left, y, { font: 'bold', size: 9 }) + 3;
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
    sumRow([g.hsnCode, `${g.gstRate}%`, money(g.taxable), money(g.cgst + g.sgst + g.igst)]);
  }

  // --- Footer ------------------------------------------------------------------------------
  y += 18;
  text(`For ${shop.legalName ?? shop.shopName}`, left, y, { font: 'bold', width, align: 'right' });
  text('Authorised signatory', left, y + 34, { size: 8, color: MUTED, width, align: 'right' });
  text('This is a computer-generated credit note.', left, y + 34, { size: 8, color: MUTED });

  doc.end();
  return done;
}
