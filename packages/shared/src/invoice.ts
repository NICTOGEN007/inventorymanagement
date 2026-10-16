import { calculateGst, taxableFromInclusive, type GstRate } from './gst.js';
import type { Paise } from './money.js';

export interface LineInput {
  /** Price per unit as printed on the shelf / entered in the product. */
  unitPrice: Paise;
  /** Units sold; may be fractional for loose goods sold by weight or volume. */
  quantity: number;
  /** Discount on the whole line, in paise. */
  discount?: Paise;
  gstRate: GstRate;
  /** True when unitPrice already includes GST (MRP-style retail pricing). */
  taxInclusive: boolean;
}

export interface LineAmounts {
  gross: Paise;
  discount: Paise;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
  total: Paise;
}

/**
 * Works out the tax and total for one invoice line.
 *
 * Tax-inclusive: the customer pays exactly (price × qty − discount) and the tax is backed out of it.
 * Tax-exclusive: GST is added on top of (price × qty − discount).
 */
export function calculateLine(input: LineInput, interState: boolean): LineAmounts {
  const { unitPrice, quantity, gstRate, taxInclusive } = input;
  const discount = input.discount ?? 0;

  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    throw new RangeError(`Unit price must be a non-negative integer of paise: ${unitPrice}`);
  }
  if (!(quantity > 0) || !Number.isFinite(quantity)) {
    throw new RangeError(`Quantity must be positive: ${quantity}`);
  }

  const gross = Math.round(unitPrice * quantity);
  if (!Number.isInteger(discount) || discount < 0 || discount > gross) {
    throw new RangeError(`Discount must be between 0 and the line amount: ${discount}`);
  }
  const net = gross - discount;

  if (!taxInclusive) {
    const gst = calculateGst(net, gstRate, interState);
    return { gross, discount, ...gst };
  }

  const taxable = taxableFromInclusive(net, gstRate);
  const totalTax = net - taxable;
  if (interState) {
    return { gross, discount, taxable, cgst: 0, sgst: 0, igst: totalTax, totalTax, total: net };
  }
  // Split so that CGST + SGST is exactly the tax collected; they differ by at most one paisa.
  const cgst = Math.ceil(totalTax / 2);
  return {
    gross,
    discount,
    taxable,
    cgst,
    sgst: totalTax - cgst,
    igst: 0,
    totalTax,
    total: net,
  };
}

export interface InvoiceTotals {
  gross: Paise;
  discount: Paise;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
  /** Adjustment to reach a whole rupee (between −50 and +49 paise). */
  roundOff: Paise;
  grandTotal: Paise;
}

/** Adds up invoice lines and rounds the amount payable to the nearest rupee. */
export function calculateInvoiceTotals(lines: readonly LineAmounts[]): InvoiceTotals {
  const sum = (key: keyof LineAmounts) => lines.reduce((acc, line) => acc + line[key], 0);
  const exact = sum('total');
  const grandTotal = Math.round(exact / 100) * 100;
  return {
    gross: sum('gross'),
    discount: sum('discount'),
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    totalTax: sum('totalTax'),
    roundOff: grandTotal - exact,
    grandTotal,
  };
}

// prettier-ignore
const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
  'Nineteen',
];
// prettier-ignore
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const unit = n % 10;
  return TENS[Math.floor(n / 10)]! + (unit ? `-${ONES[unit]}` : '');
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : '']
    .filter(Boolean)
    .join(' ');
}

/** A whole number in words in the Indian system (crore, lakh, thousand). */
export function numberInWords(value: number): string {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`Invalid number: ${value}`);
  if (value === 0) return 'Zero';
  const crore = Math.floor(value / 1e7);
  const lakh = Math.floor((value % 1e7) / 1e5);
  const thousand = Math.floor((value % 1e5) / 1e3);
  const rest = value % 1e3;
  return [
    crore ? `${numberInWords(crore)} Crore` : '',
    lakh ? `${belowHundred(lakh)} Lakh` : '',
    thousand ? `${belowHundred(thousand)} Thousand` : '',
    rest ? belowThousand(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Amount payable in words, as printed on Indian invoices: "Rupees One Hundred Only". */
export function amountInWords(paise: Paise): string {
  if (!Number.isInteger(paise) || paise < 0) throw new RangeError(`Invalid amount: ${paise}`);
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${numberInWords(rupees)}${rest ? ` and ${belowHundred(rest)} Paise` : ''} Only`;
}

export interface HsnLine {
  hsnCode: string;
  gstRate: number;
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

/** Tax grouped by HSN code and rate, the summary table printed under a GST invoice. */
export function hsnSummary(lines: readonly HsnLine[]): HsnLine[] {
  const groups = new Map<string, HsnLine>();
  for (const line of lines) {
    const key = `${line.hsnCode}|${line.gstRate}`;
    const group = groups.get(key) ?? { ...line, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    group.taxable += line.taxable;
    group.cgst += line.cgst;
    group.sgst += line.sgst;
    group.igst += line.igst;
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.gstRate - b.gstRate,
  );
}
