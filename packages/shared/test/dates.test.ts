import { describe, expect, it } from 'vitest';
import { financialYear, formatDocumentNumber, istDateKey } from '../src/dates.js';

describe('business dates', () => {
  it('uses IST for the calendar day', () => {
    // 20:00 UTC on 31 March is already 1 April in India.
    expect(istDateKey(new Date('2026-03-31T20:00:00Z'))).toBe('2026-04-01');
    expect(istDateKey(new Date('2026-03-31T18:00:00Z'))).toBe('2026-03-31');
  });

  it('computes the Indian financial year (April to March)', () => {
    expect(financialYear(new Date('2026-10-16T06:00:00Z'))).toBe('26-27');
    expect(financialYear(new Date('2026-03-31T10:00:00Z'))).toBe('25-26');
    expect(financialYear(new Date('2026-03-31T20:00:00Z'))).toBe('26-27');
    expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('99-00');
  });

  it('formats document numbers within the 16-character GST limit', () => {
    const number = formatDocumentNumber('INV', new Date('2026-10-16T06:00:00Z'), 42);
    expect(number).toBe('INV/26-27/00042');
    expect(formatDocumentNumber('RET', new Date('2026-10-16T06:00:00Z'), 99999)).toHaveLength(15);
  });

  it('rejects bad prefixes and sequences', () => {
    const date = new Date();
    expect(() => formatDocumentNumber('inv', date, 1)).toThrow(RangeError);
    expect(() => formatDocumentNumber('INVOICE', date, 1)).toThrow(RangeError);
    expect(() => formatDocumentNumber('INV', date, 0)).toThrow(RangeError);
    expect(() => formatDocumentNumber('INVC', date, 1_000_000)).toThrow(RangeError);
  });
});
