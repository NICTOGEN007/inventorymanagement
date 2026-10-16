import { taxableFromInclusive, type GstRate } from './gst.js';
import type { Paise } from './money.js';

export interface PriceBreakdown {
  /** Price before GST. */
  taxable: Paise;
  gst: Paise;
  /** What the customer pays per unit. */
  priceWithTax: Paise;
  /** Taxable price minus cost: what the shop earns per unit. */
  margin: Paise;
  /** Margin as a percentage of the taxable price (null when the price is zero). */
  marginPercent: number | null;
}

/** Splits a product's selling price into its parts, the way it will appear on an invoice. */
export function priceBreakdown(input: {
  sellingPrice: Paise;
  costPrice: Paise;
  gstRate: GstRate;
  taxInclusive: boolean;
}): PriceBreakdown {
  const { sellingPrice, costPrice, gstRate, taxInclusive } = input;
  const taxable = taxInclusive ? taxableFromInclusive(sellingPrice, gstRate) : sellingPrice;
  const priceWithTax = taxInclusive
    ? sellingPrice
    : sellingPrice + Math.round((sellingPrice * gstRate) / 100);
  const margin = taxable - costPrice;
  return {
    taxable,
    gst: priceWithTax - taxable,
    priceWithTax,
    margin,
    marginPercent: taxable > 0 ? Math.round((margin / taxable) * 1000) / 10 : null,
  };
}

export type StockStatus = 'out' | 'low' | 'ok';

/** "out" at zero, "low" at or below the reorder level, otherwise "ok". */
export function stockStatus(stock: number, reorderLevel: number): StockStatus {
  if (stock <= 0) return 'out';
  if (stock <= reorderLevel) return 'low';
  return 'ok';
}
