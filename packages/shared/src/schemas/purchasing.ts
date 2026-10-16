import { z } from 'zod';
import { PURCHASE_ORDER_STATUSES } from '../constants.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-16');
const threeDecimals = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

const quantity = z
  .number('Enter a quantity')
  .positive('Quantity must be more than 0')
  .refine(threeDecimals, 'At most 3 decimal places');

export const purchaseOrderItemInputSchema = z.object({
  product: objectId,
  quantity,
  /** Cost per unit excluding GST, in paise. */
  unitCost: z.number('Enter a cost').int('Whole paise only').min(0, 'Cannot be negative'),
});

export const purchaseOrderInputSchema = z
  .object({
    supplier: objectId,
    items: z
      .array(purchaseOrderItemInputSchema)
      .min(1, 'Add at least one product')
      .max(200, 'At most 200 lines'),
    /** Expected delivery date (IST). Defaults to today + the supplier's delivery time. */
    expectedAt: dateKey.optional(),
    notes: optionalText(500),
    /** true: place the order now; false: keep it as a draft to finish later. */
    place: z.boolean().default(false),
  })
  .refine((po) => new Set(po.items.map((i) => i.product)).size === po.items.length, {
    message: 'Each product can appear only once',
    path: ['items'],
  });
export type PurchaseOrderInput = z.output<typeof purchaseOrderInputSchema>;

export const receiveGoodsSchema = z.object({
  items: z
    .array(z.object({ product: objectId, quantity }))
    .min(1, 'Enter at least one received quantity')
    .refine(
      (items) => new Set(items.map((i) => i.product)).size === items.length,
      'Each product can appear only once',
    ),
  supplierInvoiceNumber: optionalText(40),
  note: optionalText(300),
});
export type ReceiveGoodsInput = z.output<typeof receiveGoodsSchema>;

export const cancelPurchaseOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Give a short reason').max(300),
});

export const purchaseOrderListQuerySchema = z.object({
  /** "open" = ordered or partly received. */
  status: z.enum([...PURCHASE_ORDER_STATUSES, 'open']).optional(),
  supplier: objectId.optional(),
  search: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PurchaseOrderListQuery = z.output<typeof purchaseOrderListQuerySchema>;
