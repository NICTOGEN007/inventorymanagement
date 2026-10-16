import { describe, expect, it } from 'vitest';
import {
  calculateGst,
  gstinCheckCharacter,
  isGstRate,
  isValidGstin,
  taxableFromInclusive,
} from '../src/gst.js';
import { getStateName, isStateCode } from '../src/states.js';

describe('calculateGst', () => {
  it('splits intra-state tax equally into CGST and SGST', () => {
    expect(calculateGst(10000, 18, false)).toEqual({
      taxable: 10000,
      cgst: 900,
      sgst: 900,
      igst: 0,
      totalTax: 1800,
      total: 11800,
    });
  });

  it('charges IGST for inter-state supply', () => {
    expect(calculateGst(10000, 18, true)).toMatchObject({ cgst: 0, sgst: 0, igst: 1800 });
  });

  it('keeps CGST and SGST equal when the half-rate rounds', () => {
    const r = calculateGst(333, 5, false);
    expect(r.cgst).toBe(r.sgst);
    expect(r.total).toBe(r.taxable + r.cgst + r.sgst);
  });

  it('handles exempt goods', () => {
    expect(calculateGst(5000, 0, false).totalTax).toBe(0);
  });

  it('rejects fractional or negative paise', () => {
    expect(() => calculateGst(10.5, 18, false)).toThrow(RangeError);
    expect(() => calculateGst(-1, 18, false)).toThrow(RangeError);
  });
});

describe('GST helpers', () => {
  it('backs out the taxable value from an inclusive price', () => {
    expect(taxableFromInclusive(11800, 18)).toBe(10000);
  });

  it('recognises valid slabs only', () => {
    expect(isGstRate(18)).toBe(true);
    expect(isGstRate(12)).toBe(false);
  });

  it('validates GSTIN format and check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('29AAGCB7383J1Z4')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false); // wrong check character
    expect(isValidGstin('27aapfu0939f1zv')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
  });

  it('computes the GSTIN check character', () => {
    expect(gstinCheckCharacter('27AAPFU0939F1Z')).toBe('V');
    expect(() => gstinCheckCharacter('27AAPFU0939F1-')).toThrow(RangeError);
  });

  it('maps state codes to names', () => {
    expect(getStateName('29')).toBe('Karnataka');
    expect(getStateName('99')).toBeUndefined();
    expect(isStateCode('27')).toBe(true);
    expect(isStateCode('28')).toBe(false);
  });
});
