import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const threeDecimals = (v: number) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;

/**
 * A restock plan is a draft list of what to order, grouped by supplier. Only a person can
 * confirm it, which places one purchase order per supplier.
 */
export const RESTOCK_PLAN_STATUSES = ['draft', 'confirmed', 'cancelled', 'expired'] as const;
export type RestockPlanStatus = (typeof RESTOCK_PLAN_STATUSES)[number];

/** Who prepared the plan: someone on the Smart Restock page, the dashboard alert, or the AI assistant. */
export const RESTOCK_PLAN_SOURCES = ['manual', 'alert', 'assistant'] as const;
export type RestockPlanSource = (typeof RESTOCK_PLAN_SOURCES)[number];

/** Drafts expire after this long: stock and sales move on, so the numbers go stale. */
export const RESTOCK_PLAN_TTL_HOURS = 24;

export const restockPlanCreateSchema = z.object({
  /** Only this supplier's products. */
  supplier: objectId.optional(),
  /** Spend at most this much including GST, in paise; the most urgent items go first. */
  budget: z
    .number('Enter an amount')
    .int('Whole paise only')
    .min(100, 'Budget must be at least ₹1')
    .optional(),
  source: z.enum(['manual', 'alert']).default('manual'),
});
export type RestockPlanCreateInput = z.output<typeof restockPlanCreateSchema>;

export const restockPlanUpdateSchema = z.object({
  /** The plan's lines after editing; products left out are removed. */
  items: z
    .array(
      z.object({
        product: objectId,
        quantity: z
          .number('Enter a quantity')
          .positive('Quantity must be more than 0')
          .max(100_000, 'That is too many')
          .refine(threeDecimals, 'At most 3 decimal places'),
      }),
    )
    .min(1, 'Keep at least one item, or cancel the plan')
    .max(200, 'At most 200 items')
    .refine(
      (items) => new Set(items.map((i) => i.product)).size === items.length,
      'Each product can appear only once',
    ),
});
export type RestockPlanUpdateInput = z.output<typeof restockPlanUpdateSchema>;

export const restockPlanListQuerySchema = z.object({
  status: z.enum(RESTOCK_PLAN_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type RestockPlanListQuery = z.output<typeof restockPlanListQuerySchema>;
