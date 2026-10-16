import { describe, expect, it } from 'vitest';
import { amountInWords, hsnSummary, numberInWords } from '../src/invoice.js';
import { saleInputSchema, saleListQuerySchema } from '../src/schemas/sales.js';

const p1 = '507f1f77bcf86cd799439012';
const p2 = '507f1f77bcf86cd799439013';
const cash = { method: 'cash', amount: 10000 };

describe('sale schemas', () => {
  it('accepts a walk-in sale and defaults line discounts to zero', () => {
    const sale = saleInputSchema.parse({
      items: [
        { product: p1, quantity: 2 },
        { product: p2, quantity: 0.75, discount: 500 },
      ],
      payments: [cash, { method: 'upi', amount: 2500, reference: ' 4321 ' }],
      notes: '',
    });
    expect(sale.items[0]!.discount).toBe(0);
    expect(sale.customer).toBeUndefined();
    expect(sale.notes).toBeUndefined();
    expect(sale.payments[1]!.reference).toBe('4321');
  });

  it('rejects empty bills, repeated products or methods and impossible amounts', () => {
    const messages = (input: object) =>
      saleInputSchema.safeParse(input).error?.issues.map((i) => i.message) ?? [];
    expect(messages({ items: [], payments: [cash] })).toContain('Add at least one product');
    expect(
      messages({
        items: [
          { product: p1, quantity: 1 },
          { product: p1, quantity: 2 },
        ],
        payments: [cash],
      }),
    ).toContain('Each product can appear only once');
    expect(messages({ items: [{ product: p1, quantity: 1 }], payments: [cash, cash] })).toContain(
      'Use each payment method once',
    );
    expect(messages({ items: [{ product: p1, quantity: 1 }], payments: [] })).toContain(
      'Add a payment',
    );
    const bad = messages({
      items: [{ product: p1, quantity: 1.0005, discount: 10.5 }],
      payments: [{ method: 'cheque', amount: 0 }],
    });
    expect(bad).toEqual(
      expect.arrayContaining([
        'At most 3 decimal places',
        'Whole paise only',
        'Choose cash, UPI or card',
        'Amount must be more than 0',
      ]),
    );
  });

  it('accepts a bill reference from the till and rejects odd ones', () => {
    const base = { items: [{ product: p1, quantity: 1 }], payments: [cash] };
    expect(
      saleInputSchema.parse({ ...base, clientRef: 'b3f1c2d4-5e6f-4a1b-9c8d-7e6f5a4b3c2d' }),
    ).toHaveProperty('clientRef');
    expect(saleInputSchema.safeParse({ ...base, clientRef: 'x' }).success).toBe(false);
  });

  it('parses list filters and rejects reversed dates', () => {
    expect(saleListQuerySchema.parse({ from: '2026-10-01', method: 'upi' })).toMatchObject({
      from: '2026-10-01',
      method: 'upi',
      page: 1,
      pageSize: 20,
    });
    expect(saleListQuerySchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success).toBe(
      false,
    );
  });
});

describe('amount in words', () => {
  it('uses the Indian numbering system', () => {
    expect(numberInWords(0)).toBe('Zero');
    expect(numberInWords(15)).toBe('Fifteen');
    expect(numberInWords(99)).toBe('Ninety-Nine');
    expect(numberInWords(105)).toBe('One Hundred Five');
    expect(numberInWords(1_23_456)).toBe('One Lakh Twenty-Three Thousand Four Hundred Fifty-Six');
    expect(numberInWords(2_00_00_000)).toBe('Two Crore');
    expect(numberInWords(12_34_56_789)).toBe(
      'Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine',
    );
  });

  it('writes rupees and paise as printed on invoices', () => {
    expect(amountInWords(11800)).toBe('Rupees One Hundred Eighteen Only');
    expect(amountInWords(123450)).toBe(
      'Rupees One Thousand Two Hundred Thirty-Four and Fifty Paise Only',
    );
    expect(amountInWords(5)).toBe('Rupees Zero and Five Paise Only');
    expect(() => amountInWords(-1)).toThrow(RangeError);
  });
});

describe('HSN summary', () => {
  it('groups tax by HSN code and rate', () => {
    const line = (hsnCode: string, gstRate: number, taxable: number, tax: number) => ({
      hsnCode,
      gstRate,
      taxable,
      cgst: tax / 2,
      sgst: tax / 2,
      igst: 0,
    });
    expect(
      hsnSummary([
        line('1006', 5, 10000, 500),
        line('0401', 0, 5600, 0),
        line('1006', 5, 20000, 1000),
      ]),
    ).toEqual([line('0401', 0, 5600, 0), line('1006', 5, 30000, 1500)]);
  });
});
