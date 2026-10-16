import { z } from 'zod';
import { ADJUSTMENT_REASONS, REDUCING_REASONS, STOCK_MOVEMENT_TYPES } from '../constants.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-16');
const threeDecimals = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;

export const adjustmentItemSchema = z
  .object({
    product: objectId,
    /** "set": the counted quantity on the shelf. "change": add (+) or remove (−) this much. */
    mode: z.enum(['set', 'change']),
    quantity: z
      .number('Enter a quantity')
      .refine(Number.isFinite, 'Enter a quantity')
      .refine(threeDecimals, 'At most 3 decimal places'),
  })
  .refine((i) => i.mode === 'change' || i.quantity >= 0, {
    message: 'A counted quantity cannot be negative',
    path: ['quantity'],
  })
  .refine((i) => i.mode === 'set' || i.quantity !== 0, {
    message: 'Enter a change other than 0',
    path: ['quantity'],
  });

export const stockAdjustmentSchema = z
  .object({
    reason: z.enum(ADJUSTMENT_REASONS, 'Choose a reason'),
    note: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === '' ? undefined : v))
      .optional(),
    items: z
      .array(adjustmentItemSchema)
      .min(1, 'Add at least one product')
      .max(200, 'At most 200 products at once'),
  })
  .refine((a) => new Set(a.items.map((i) => i.product)).size === a.items.length, {
    message: 'Each product can appear only once',
    path: ['items'],
  })
  .refine((a) => a.reason !== 'other' || a.note !== undefined, {
    message: 'Explain the adjustment when the reason is "Other"',
    path: ['note'],
  })
  .refine(
    (a) =>
      !REDUCING_REASONS.includes(a.reason) ||
      a.items.every((i) => i.mode === 'set' || i.quantity < 0),
    {
      message: 'Damaged, expired or lost stock can only be removed',
      path: ['items'],
    },
  );
export type StockAdjustmentInput = z.output<typeof stockAdjustmentSchema>;
export type StockAdjustmentFormValues = z.input<typeof stockAdjustmentSchema>;

export const movementListQuerySchema = z
  .object({
    product: objectId.optional(),
    type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
    from: dateKey.optional(),
    to: dateKey.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '"From" must be before "to"',
    path: ['from'],
  });
export type MovementListQuery = z.output<typeof movementListQuerySchema>;
