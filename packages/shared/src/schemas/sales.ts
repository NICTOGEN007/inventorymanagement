import { z } from 'zod';
import { PAYMENT_METHODS } from '../constants.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-16');
const threeDecimals = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
const paise = (label: string) =>
  z.number(`Enter ${label}`).int('Whole paise only').min(0, 'Cannot be negative');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const saleItemInputSchema = z.object({
  product: objectId,
  quantity: z
    .number('Enter a quantity')
    .positive('Quantity must be more than 0')
    .refine(threeDecimals, 'At most 3 decimal places'),
  /** Discount on the whole line, in paise. */
  discount: paise('a discount').default(0),
});

export const paymentInputSchema = z.object({
  method: z.enum(PAYMENT_METHODS, 'Choose cash, UPI or card'),
  amount: paise('an amount').positive('Amount must be more than 0'),
  /** UPI transaction id or card approval code. */
  reference: optionalText(60),
});

export const saleInputSchema = z
  .object({
    items: z
      .array(saleItemInputSchema)
      .min(1, 'Add at least one product')
      .max(200, 'At most 200 lines'),
    /** Registered customer; leave out for a walk-in customer. */
    customer: objectId.optional(),
    payments: z
      .array(paymentInputSchema)
      .min(1, 'Add a payment')
      .max(3, 'At most three payments')
      .refine(
        (p) => new Set(p.map((x) => x.method)).size === p.length,
        'Use each payment method once',
      ),
    notes: optionalText(500),
    /**
     * Chosen by the till for each bill. Sending the same bill twice (a double click, or a retry
     * after a dropped connection) returns the first invoice instead of billing twice.
     */
    clientRef: z
      .string()
      .regex(/^[A-Za-z0-9-]{8,64}$/, 'Invalid bill reference')
      .optional(),
  })
  .refine((s) => new Set(s.items.map((i) => i.product)).size === s.items.length, {
    message: 'Each product can appear only once',
    path: ['items'],
  });
export type SaleInput = z.output<typeof saleInputSchema>;
export type SaleFormValues = z.input<typeof saleInputSchema>;

export const saleListQuerySchema = z
  .object({
    /** IST calendar days, inclusive. */
    from: dateKey.optional(),
    to: dateKey.optional(),
    /** Invoice number, customer name or phone. */
    search: z.string().trim().max(60).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    cashier: objectId.optional(),
    /** A customer's purchase history. */
    customer: objectId.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start date must be before the end date',
    path: ['to'],
  });
export type SaleListQuery = z.output<typeof saleListQuerySchema>;

// ---------------------------------------------------------------------------
// Returns

const returnQuantity = z
  .number('Enter a quantity')
  .positive('Quantity must be more than 0')
  .refine(threeDecimals, 'At most 3 decimal places');

export const saleReturnItemInputSchema = z.object({
  product: objectId,
  quantity: returnQuantity,
  /** Goods in sellable condition go back on the shelf; damaged ones do not. */
  restock: z.boolean().default(true),
});

export const saleReturnInputSchema = z.object({
  /** The original sale; a return is always against an invoice. */
  sale: objectId,
  items: z
    .array(saleReturnItemInputSchema)
    .min(1, 'Choose at least one item to return')
    .max(200, 'At most 200 lines')
    .refine(
      (items) => new Set(items.map((i) => i.product)).size === items.length,
      'Each product can appear only once',
    ),
  refundMethod: z.enum(PAYMENT_METHODS, 'Choose how the money goes back'),
  /** UPI transaction id or card reversal reference. */
  refundReference: optionalText(60),
  reason: z.string().trim().min(3, 'Give a short reason').max(300),
  /** Same idea as on a sale: sending the same return twice takes the goods back once. */
  clientRef: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/, 'Invalid return reference')
    .optional(),
});
export type SaleReturnInput = z.output<typeof saleReturnInputSchema>;

export const saleReturnListQuerySchema = z
  .object({
    from: dateKey.optional(),
    to: dateKey.optional(),
    /** Return number, invoice number or customer name. */
    search: z.string().trim().max(60).optional(),
    customer: objectId.optional(),
    sale: objectId.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start date must be before the end date',
    path: ['to'],
  });
export type SaleReturnListQuery = z.output<typeof saleReturnListQuerySchema>;
