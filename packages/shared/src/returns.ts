import type { Paise } from './money.js';

/** Taxable value and GST of an invoice line or part of one, in paise. */
export interface TaxSplit {
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

/** An invoice line as far as returns are concerned. */
export interface ReturnableLine extends TaxSplit {
  quantity: number;
  /** Already taken back on earlier returns. */
  returnedQuantity: number;
  /** Already refunded on earlier returns. */
  refunded: TaxSplit;
}

export interface ReturnLineAmounts extends TaxSplit {
  total: Paise;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const KEYS = ['taxable', 'cgst', 'sgst', 'igst'] as const;

/** Quantity of a line that can still be returned. */
export function returnableQuantity(line: Pick<ReturnableLine, 'quantity' | 'returnedQuantity'>) {
  return Math.max(0, round3(line.quantity - line.returnedQuantity));
}

/**
 * What taking back `quantity` of a line refunds: its share of what has not been refunded yet.
 * Returning everything that is left refunds exactly what is left, so a line returned in parts
 * never refunds a paisa more (or less) than the customer paid for it.
 */
export function returnLineAmounts(line: ReturnableLine, quantity: number): ReturnLineAmounts {
  const remaining = returnableQuantity(line);
  if (!(quantity > 0) || quantity > remaining + 1e-9) {
    throw new RangeError(`Can return between 0 and ${remaining}`);
  }
  const all = quantity >= remaining - 1e-9;
  const share = (key: (typeof KEYS)[number]) => {
    const left = line[key] - line.refunded[key];
    return all ? left : Math.round((left * quantity) / remaining);
  };
  const [taxable, cgst, sgst, igst] = KEYS.map(share) as [number, number, number, number];
  return { taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst };
}

export interface ReturnTotals extends TaxSplit {
  totalTax: Paise;
  /** Adjustment to reach a whole rupee. */
  roundOff: Paise;
  totalRefund: Paise;
}

/**
 * Adds up a return and rounds the refund to the rupee, as the invoice was. The refund never goes
 * past what is left of the bill, and the return that takes back the last item refunds exactly
 * what is left, so all the refunds on a bill add up to what the customer paid.
 */
export function calculateReturnTotals(
  lines: readonly ReturnLineAmounts[],
  sale: { grandTotal: Paise; refundedTotal: Paise },
  completesSale: boolean,
): ReturnTotals {
  const sum = (key: keyof ReturnLineAmounts) => lines.reduce((acc, l) => acc + l[key], 0);
  const exact = sum('total');
  const left = Math.max(0, sale.grandTotal - sale.refundedTotal);
  const totalRefund = completesSale ? left : Math.min(left, Math.round(exact / 100) * 100);
  const cgst = sum('cgst');
  const sgst = sum('sgst');
  const igst = sum('igst');
  return {
    taxable: sum('taxable'),
    cgst,
    sgst,
    igst,
    totalTax: cgst + sgst + igst,
    roundOff: totalRefund - exact,
    totalRefund,
  };
}
