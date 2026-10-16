import { describe, expect, it } from 'vitest';
import { allowsFractions } from '../src/constants.js';
import { istDayRange } from '../src/dates.js';
import { movementListQuerySchema, stockAdjustmentSchema } from '../src/schemas/inventory.js';

const id = '507f1f77bcf86cd799439011';
const id2 = '507f1f77bcf86cd799439012';

describe('stockAdjustmentSchema', () => {
  it('accepts a stock count and a change', () => {
    const r = stockAdjustmentSchema.parse({
      reason: 'count',
      note: '',
      items: [
        { product: id, mode: 'set', quantity: 12 },
        { product: id2, mode: 'change', quantity: -2.5 },
      ],
    });
    expect(r.note).toBeUndefined();
    expect(r.items).toHaveLength(2);
  });

  it('rejects duplicates, empty lists and impossible quantities', () => {
    const issues = (input: object) =>
      stockAdjustmentSchema.safeParse(input).error?.issues.map((i) => i.message);
    expect(issues({ reason: 'count', items: [] })).toContain('Add at least one product');
    expect(
      issues({
        reason: 'count',
        items: [
          { product: id, mode: 'set', quantity: 1 },
          { product: id, mode: 'set', quantity: 2 },
        ],
      }),
    ).toContain('Each product can appear only once');
    expect(
      issues({ reason: 'count', items: [{ product: id, mode: 'set', quantity: -1 }] }),
    ).toContain('A counted quantity cannot be negative');
    expect(
      issues({ reason: 'count', items: [{ product: id, mode: 'change', quantity: 0 }] }),
    ).toContain('Enter a change other than 0');
    expect(
      issues({ reason: 'count', items: [{ product: id, mode: 'change', quantity: 1.2345 }] }),
    ).toContain('At most 3 decimal places');
  });

  it('only lets damage, expiry and loss remove stock', () => {
    expect(
      stockAdjustmentSchema.safeParse({
        reason: 'damaged',
        items: [{ product: id, mode: 'change', quantity: -1 }],
      }).success,
    ).toBe(true);
    expect(
      stockAdjustmentSchema.safeParse({
        reason: 'damaged',
        items: [{ product: id, mode: 'change', quantity: 3 }],
      }).success,
    ).toBe(false);
  });

  it('requires a note for "other"', () => {
    const r = stockAdjustmentSchema.safeParse({
      reason: 'other',
      items: [{ product: id, mode: 'change', quantity: 1 }],
    });
    expect(r.error?.issues[0]?.path).toEqual(['note']);
  });
});

describe('movementListQuerySchema', () => {
  it('parses filters and rejects reversed date ranges', () => {
    expect(movementListQuerySchema.parse({ type: 'sale', page: '3' })).toMatchObject({
      type: 'sale',
      page: 3,
      pageSize: 25,
    });
    expect(
      movementListQuerySchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success,
    ).toBe(false);
  });
});

describe('helpers', () => {
  it('knows which units allow fractions', () => {
    expect(allowsFractions('kg')).toBe(true);
    expect(allowsFractions('pcs')).toBe(false);
  });

  it('maps an IST calendar day to its UTC range', () => {
    const { start, end } = istDayRange('2026-10-16');
    expect(start.toISOString()).toBe('2026-10-15T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-16T18:30:00.000Z');
    expect(() => istDayRange('16/10/2026')).toThrow(RangeError);
  });
});
