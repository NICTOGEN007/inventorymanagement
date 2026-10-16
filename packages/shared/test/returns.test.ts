import { describe, expect, it } from 'vitest';
import { gstinCheckCharacter } from '../src/gst.js';
import {
  calculateReturnTotals,
  returnableQuantity,
  returnLineAmounts,
  type ReturnableLine,
} from '../src/returns.js';
import { customerInputSchema, customerListQuerySchema } from '../src/schemas/customers.js';
import { saleReturnInputSchema } from '../src/schemas/sales.js';

const none = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
// 3 soaps: taxable ₹127.12, CGST/SGST ₹11.44 each (₹150 incl. 18% GST).
const soap: ReturnableLine = {
  quantity: 3,
  returnedQuantity: 0,
  taxable: 12712,
  cgst: 1144,
  sgst: 1144,
  igst: 0,
  refunded: none,
};

const after = (line: ReturnableLine, quantity: number): ReturnableLine => {
  const a = returnLineAmounts(line, quantity);
  return {
    ...line,
    returnedQuantity: line.returnedQuantity + quantity,
    refunded: {
      taxable: line.refunded.taxable + a.taxable,
      cgst: line.refunded.cgst + a.cgst,
      sgst: line.refunded.sgst + a.sgst,
      igst: line.refunded.igst + a.igst,
    },
  };
};

describe('return amounts', () => {
  it('refunds a share of the line and exactly what is left on the last part', () => {
    const first = returnLineAmounts(soap, 1);
    expect(first).toEqual({ taxable: 4237, cgst: 381, sgst: 381, igst: 0, total: 4999 });
    const second = returnLineAmounts(after(soap, 1), 1);
    const last = returnLineAmounts(after(after(soap, 1), 1), 1);
    // However it is split, the parts add up to the line.
    expect(first.total + second.total + last.total).toBe(12712 + 1144 + 1144);
    expect(first.taxable + second.taxable + last.taxable).toBe(12712);
    expect(returnLineAmounts(soap, 3).total).toBe(15000);
  });

  it('handles loose goods and refuses more than is left', () => {
    const sugar: ReturnableLine = {
      ...none,
      quantity: 1.25,
      returnedQuantity: 0.5,
      refunded: none,
    };
    sugar.taxable = 6000;
    expect(returnableQuantity(sugar)).toBe(0.75);
    expect(returnLineAmounts(sugar, 0.25).taxable).toBe(2000);
    expect(() => returnLineAmounts(sugar, 0.8)).toThrow(RangeError);
    expect(() => returnLineAmounts(sugar, 0)).toThrow(RangeError);
  });

  it('rounds the refund to the rupee and never refunds more than the bill', () => {
    const line = returnLineAmounts(soap, 1); // ₹49.99
    const partial = calculateReturnTotals([line], { grandTotal: 15000, refundedTotal: 0 }, false);
    expect(partial).toMatchObject({ totalRefund: 5000, roundOff: 1, totalTax: 762 });

    // The return that empties the bill refunds exactly what is left of it.
    const rest = returnLineAmounts(after(soap, 1), 2);
    const final = calculateReturnTotals([rest], { grandTotal: 15000, refundedTotal: 5000 }, true);
    expect(final.totalRefund).toBe(10000);
    expect(final.roundOff).toBe(10000 - rest.total);

    const capped = calculateReturnTotals(
      [line],
      { grandTotal: 15000, refundedTotal: 14980 },
      false,
    );
    expect(capped.totalRefund).toBe(20);
  });
});

describe('return and customer schemas', () => {
  const id = '507f1f77bcf86cd799439012';

  it('accepts a return and defaults goods back to stock', () => {
    const parsed = saleReturnInputSchema.parse({
      sale: id,
      items: [{ product: id, quantity: 1 }],
      refundMethod: 'cash',
      reason: ' Damaged pack ',
      refundReference: '',
    });
    expect(parsed.items[0]!.restock).toBe(true);
    expect(parsed.reason).toBe('Damaged pack');
    expect(parsed.refundReference).toBeUndefined();
    const issues = saleReturnInputSchema
      .safeParse({
        sale: id,
        items: [],
        refundMethod: 'cheque',
        reason: 'x',
      })
      .error?.issues.map((i) => i.message);
    expect(issues).toEqual(
      expect.arrayContaining([
        'Choose at least one item to return',
        'Choose how the money goes back',
        'Give a short reason',
      ]),
    );
  });

  it('takes the state from the GSTIN and checks they match', () => {
    const body = '33AABCH1234K1Z';
    const gstin = body + gstinCheckCharacter(body);
    const parsed = customerInputSchema.parse({ name: 'Hosur Mini Mart', gstin, phone: '' });
    expect(parsed.stateCode).toBe('33');
    expect(parsed.phone).toBeUndefined();
    const mismatch = customerInputSchema.safeParse({
      name: 'Hosur Mini Mart',
      gstin,
      stateCode: '29',
    });
    expect(mismatch.error?.issues[0]?.path).toEqual(['gstin']);
    expect(customerListQuerySchema.parse({}).status).toBe('active');
  });
});
