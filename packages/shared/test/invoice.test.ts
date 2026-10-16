import { describe, expect, it } from 'vitest';
import { calculateInvoiceTotals, calculateLine } from '../src/invoice.js';

describe('calculateLine', () => {
  it('backs tax out of an MRP-inclusive price so the customer pays the shelf price', () => {
    const line = calculateLine(
      { unitPrice: 11800, quantity: 2, gstRate: 18, taxInclusive: true },
      false,
    );
    expect(line).toEqual({
      gross: 23600,
      discount: 0,
      taxable: 20000,
      cgst: 1800,
      sgst: 1800,
      igst: 0,
      totalTax: 3600,
      total: 23600,
    });
  });

  it('adds tax on top of a tax-exclusive price', () => {
    const line = calculateLine(
      { unitPrice: 10000, quantity: 1, gstRate: 5, taxInclusive: false },
      false,
    );
    expect(line).toMatchObject({ taxable: 10000, cgst: 250, sgst: 250, total: 10500 });
  });

  it('applies the discount before tax', () => {
    const line = calculateLine(
      { unitPrice: 10000, quantity: 1, discount: 1000, gstRate: 18, taxInclusive: false },
      false,
    );
    expect(line).toMatchObject({ gross: 10000, taxable: 9000, totalTax: 1620, total: 10620 });
  });

  it('charges IGST on inter-state sales', () => {
    const line = calculateLine(
      { unitPrice: 11800, quantity: 1, gstRate: 18, taxInclusive: true },
      true,
    );
    expect(line).toMatchObject({ cgst: 0, sgst: 0, igst: 1800, total: 11800 });
  });

  it('keeps CGST + SGST equal to the tax when it is an odd number of paise', () => {
    const line = calculateLine(
      { unitPrice: 4999, quantity: 1, gstRate: 5, taxInclusive: true },
      false,
    );
    expect(line.cgst + line.sgst).toBe(line.totalTax);
    expect(Math.abs(line.cgst - line.sgst)).toBeLessThanOrEqual(1);
    expect(line.taxable + line.totalTax).toBe(4999);
  });

  it('supports fractional quantities for loose goods', () => {
    const line = calculateLine(
      { unitPrice: 4500, quantity: 1.5, gstRate: 0, taxInclusive: true },
      false,
    );
    expect(line).toMatchObject({ gross: 6750, totalTax: 0, total: 6750 });
  });

  it('rejects invalid input', () => {
    const base = { unitPrice: 1000, quantity: 1, gstRate: 5 as const, taxInclusive: true };
    expect(() => calculateLine({ ...base, quantity: 0 }, false)).toThrow(RangeError);
    expect(() => calculateLine({ ...base, unitPrice: 10.5 }, false)).toThrow(RangeError);
    expect(() => calculateLine({ ...base, discount: 1001 }, false)).toThrow(RangeError);
  });
});

describe('calculateInvoiceTotals', () => {
  it('sums lines and rounds to the nearest rupee', () => {
    const lines = [
      calculateLine({ unitPrice: 4999, quantity: 1, gstRate: 5, taxInclusive: true }, false),
      calculateLine({ unitPrice: 2025, quantity: 2, gstRate: 18, taxInclusive: true }, false),
    ];
    const totals = calculateInvoiceTotals(lines);
    expect(totals.gross).toBe(9049);
    expect(totals.roundOff).toBe(-49);
    expect(totals.grandTotal).toBe(9000);
    expect(totals.taxable + totals.totalTax).toBe(9049);
  });

  it('rounds half a rupee up', () => {
    const lines = [
      calculateLine({ unitPrice: 150, quantity: 1, gstRate: 0, taxInclusive: true }, false),
    ];
    expect(calculateInvoiceTotals(lines)).toMatchObject({ roundOff: 50, grandTotal: 200 });
  });

  it('handles an empty invoice', () => {
    expect(calculateInvoiceTotals([]).grandTotal).toBe(0);
  });
});
