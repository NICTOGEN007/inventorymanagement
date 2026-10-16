import { z } from 'zod';
import { gstinSchema, phoneSchema, pincodeSchema, stateCodeSchema } from './catalog.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

export const customerInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
    /** Used to find the customer at the till, so it must be unique. */
    phone: optional(phoneSchema),
    email: optional(z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'))),
    /** Business customers give a GSTIN so they can claim input tax credit. */
    gstin: optional(gstinSchema),
    /** Place of supply. Leave out for a local customer: the shop's own state is used. */
    stateCode: optional(stateCodeSchema),
    address: z
      .object({
        line1: optionalText(120),
        line2: optionalText(120),
        city: optionalText(60),
        pincode: optional(pincodeSchema),
      })
      .optional(),
    isActive: z.boolean().optional(),
  })
  // A GSTIN starts with its state code, so it also decides the place of supply.
  .transform((c) =>
    c.gstin && !c.stateCode
      ? { ...c, stateCode: c.gstin.slice(0, 2) as NonNullable<typeof c.stateCode> }
      : c,
  )
  .refine((c) => !c.gstin || c.gstin.slice(0, 2) === c.stateCode, {
    message: "The GSTIN's first two digits must match the customer's state",
    path: ['gstin'],
  });
export type CustomerInput = z.output<typeof customerInputSchema>;
export type CustomerFormValues = z.input<typeof customerInputSchema>;

export const CUSTOMER_STATUS_FILTERS = ['active', 'inactive', 'all'] as const;

export const customerListQuerySchema = z.object({
  /** Name, phone or GSTIN. */
  search: z.string().trim().max(60).optional(),
  status: z.enum(CUSTOMER_STATUS_FILTERS).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type CustomerListQuery = z.output<typeof customerListQuerySchema>;
