import { describe, expect, it } from 'vitest';
import { formatINR, formatINRCompact, paiseToRupees, rupeesToPaise } from '../src/money.js';

describe('money', () => {
  it('converts rupees to integer paise without float drift', () => {
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(paiseToRupees(1999)).toBe(19.99);
  });

  it('rejects non-finite amounts', () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrow(RangeError);
  });

  it('formats in the Indian numbering system', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456.00');
    expect(formatINR(5)).toBe('₹0.05');
  });

  it('formats headline figures compactly in lakh and crore', () => {
    expect(formatINRCompact(99900)).toBe('₹999');
    expect(formatINRCompact(6910050)).toBe('₹69,101'); // under a lakh: exact rupees
    expect(formatINRCompact(-250000)).toBe('-₹2,500');
    expect(formatINRCompact(234567800)).toBe('₹23.5L');
    expect(formatINRCompact(987654321)).toBe('₹98.8L');
    expect(formatINRCompact(12345678900)).toBe('₹12.3Cr');
  });
});
