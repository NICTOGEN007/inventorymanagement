import { describe, expect, it } from 'vitest';
import { formatINR, paiseToRupees, rupeesToPaise } from '../src/money.js';

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
});
