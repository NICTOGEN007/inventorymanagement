import { describe, expect, it } from 'vitest';
import {
  purchaseOrderInputSchema,
  purchaseOrderListQuerySchema,
  receiveGoodsSchema,
} from '../src/schemas/purchasing.js';

const supplier = '507f1f77bcf86cd799439011';
const p1 = '507f1f77bcf86cd799439012';
const p2 = '507f1f77bcf86cd799439013';

describe('purchase order schemas', () => {
  it('accepts a draft by default and a placed order on request', () => {
    const draft = purchaseOrderInputSchema.parse({
      supplier,
      items: [{ product: p1, quantity: 24, unitCost: 5000 }],
      notes: '',
    });
    expect(draft.place).toBe(false);
    expect(draft.notes).toBeUndefined();
    expect(
      purchaseOrderInputSchema.parse({
        supplier,
        items: [{ product: p1, quantity: 2.5, unitCost: 4200 }],
        place: true,
      }).place,
    ).toBe(true);
  });

  it('rejects empty orders, duplicates, zero quantities and fractional paise', () => {
    const messages = (input: object) =>
      purchaseOrderInputSchema.safeParse(input).error?.issues.map((i) => i.message);
    expect(messages({ supplier, items: [] })).toContain('Add at least one product');
    expect(
      messages({
        supplier,
        items: [
          { product: p1, quantity: 1, unitCost: 1 },
          { product: p1, quantity: 2, unitCost: 1 },
        ],
      }),
    ).toContain('Each product can appear only once');
    expect(messages({ supplier, items: [{ product: p1, quantity: 0, unitCost: 1 }] })).toContain(
      'Quantity must be more than 0',
    );
    expect(messages({ supplier, items: [{ product: p2, quantity: 1, unitCost: 10.5 }] })).toContain(
      'Whole paise only',
    );
  });

  it('validates receipts', () => {
    expect(
      receiveGoodsSchema.safeParse({
        items: [{ product: p1, quantity: 5 }],
        supplierInvoiceNumber: 'SI-1',
      }).success,
    ).toBe(true);
    expect(receiveGoodsSchema.safeParse({ items: [] }).success).toBe(false);
    expect(receiveGoodsSchema.safeParse({ items: [{ product: p1, quantity: -1 }] }).success).toBe(
      false,
    );
  });

  it('accepts "open" as a list status', () => {
    expect(purchaseOrderListQuerySchema.parse({ status: 'open' }).status).toBe('open');
    expect(purchaseOrderListQuerySchema.safeParse({ status: 'lost' }).success).toBe(false);
  });
});
