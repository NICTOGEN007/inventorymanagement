import { z } from 'zod';
import { daysInPeriod, REPORT_GROUPINGS } from '../reports.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-16')
  .refine((v) => {
    const ms = Date.parse(`${v}T00:00:00Z`);
    return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(v);
  }, 'Not a real date');

/** About three years: enough for year-on-year, small enough to answer quickly. */
export const MAX_REPORT_DAYS = 1100;

const period = {
  /** IST calendar days, inclusive. Leave out for the default period. */
  from: dateKey.optional(),
  to: dateKey.optional(),
};
const checkPeriod = <T extends { from?: string; to?: string }>(schema: z.ZodType<T>) =>
  schema
    .refine((q) => !q.from || !q.to || q.from <= q.to, {
      message: 'The start date must be before the end date',
      path: ['to'],
    })
    .refine((q) => !q.from || !q.to || daysInPeriod(q.from, q.to) <= MAX_REPORT_DAYS, {
      message: `Choose at most ${MAX_REPORT_DAYS} days`,
      path: ['from'],
    });

export const dashboardQuerySchema = checkPeriod(z.object(period));
export type DashboardQuery = z.output<typeof dashboardQuerySchema>;

export const STOCK_REPORT_FILTERS = ['all', 'low', 'out', 'dead'] as const;
export const PRODUCT_REPORT_SORTS = ['sales', 'profit', 'quantity'] as const;
export const REPORT_FORMATS = ['json', 'csv', 'pdf'] as const;

export const reportQuerySchema = checkPeriod(
  z.object({
    ...period,
    /** Sales report: one row per day, week or month. */
    groupBy: z.enum(REPORT_GROUPINGS).default('day'),
    /** Products and stock reports. */
    category: objectId.optional(),
    sort: z.enum(PRODUCT_REPORT_SORTS).default('sales'),
    stock: z.enum(STOCK_REPORT_FILTERS).default('all'),
    format: z.enum(REPORT_FORMATS).default('json'),
    /** CSV holds one table: which section to export (the first by default). */
    section: z
      .string()
      .regex(/^[a-z-]{1,30}$/)
      .optional(),
  }),
);
export type ReportQuery = z.output<typeof reportQuerySchema>;
