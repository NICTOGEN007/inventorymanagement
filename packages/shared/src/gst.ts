import type { Paise } from './money.js';

/**
 * GST slabs after the September 2025 rationalisation ("GST 2.0"):
 * 0% (exempt), 5% (merit), 18% (standard), 40% (luxury/sin goods),
 * plus the special 0.25% and 3% rates for precious stones and metals.
 */
export const GST_RATES = [0, 0.25, 3, 5, 18, 40] as const;
export type GstRate = (typeof GST_RATES)[number];

export function isGstRate(value: number): value is GstRate {
  return (GST_RATES as readonly number[]).includes(value);
}

export interface GstBreakup {
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
  total: Paise;
}

/**
 * Splits tax on a taxable amount.
 * Intra-state supply (seller and buyer in the same state) -> CGST + SGST, half the rate each.
 * Inter-state supply -> IGST at the full rate.
 */
export function calculateGst(taxable: Paise, rate: GstRate, interState: boolean): GstBreakup {
  if (!Number.isInteger(taxable) || taxable < 0) {
    throw new RangeError(`Taxable amount must be a non-negative integer of paise: ${taxable}`);
  }
  if (interState) {
    const igst = Math.round((taxable * rate) / 100);
    return { taxable, cgst: 0, sgst: 0, igst, totalTax: igst, total: taxable + igst };
  }
  const half = Math.round((taxable * rate) / 200);
  return {
    taxable,
    cgst: half,
    sgst: half,
    igst: 0,
    totalTax: half * 2,
    total: taxable + half * 2,
  };
}

/** Extracts the taxable value from a tax-inclusive price (MRP-style pricing). */
export function taxableFromInclusive(inclusive: Paise, rate: GstRate): Paise {
  return Math.round((inclusive * 100) / (100 + rate));
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Checks the 15-character GSTIN format; the first two digits are the state code. */
export function isValidGstin(gstin: string): boolean {
  return GSTIN_PATTERN.test(gstin);
}
