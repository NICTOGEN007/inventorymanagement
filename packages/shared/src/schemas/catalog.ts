import { z } from 'zod';
import { UNITS } from '../constants.js';
import { GST_RATES, isValidGstin } from '../gst.js';
import { isValidGtin } from '../barcode.js';
import { INDIAN_STATES, type StateCode } from '../states.js';

/** Optional text field: trims, and turns an empty string into "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

const paise = (label: string) =>
  z.number().int(`${label} must be a whole number of paise`).min(0, `${label} cannot be negative`);

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export const stateCodeSchema = z.enum(
  INDIAN_STATES.map((s) => s.code) as [StateCode, ...StateCode[]],
  'Choose a state',
);

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidGstin, 'Enter a valid 15-character GSTIN');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number');

export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code');

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

// ---------------------------------------------------------------------------
// Categories

export const categoryInputSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  description: optionalText(300),
  isActive: z.boolean().optional(),
});
/** Validated data (what the API works with). */
export type CategoryInput = z.output<typeof categoryInputSchema>;
/** Raw form values (what a form holds before validation). */
export type CategoryFormValues = z.input<typeof categoryInputSchema>;

export const categoryUpdateSchema = categoryInputSchema.partial();

// ---------------------------------------------------------------------------
// Suppliers

export const supplierInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
    contactPerson: optionalText(100),
    phone: optional(phoneSchema),
    email: optional(z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'))),
    gstin: optional(gstinSchema),
    stateCode: stateCodeSchema,
    address: z
      .object({
        line1: optionalText(120),
        line2: optionalText(120),
        city: optionalText(60),
        pincode: optional(pincodeSchema),
      })
      .optional(),
    leadTimeDays: z.number().int().min(0, 'Cannot be negative').max(90, 'At most 90 days'),
    isActive: z.boolean().optional(),
  })
  .refine((s) => !s.gstin || s.gstin.slice(0, 2) === s.stateCode, {
    message: "The GSTIN's first two digits must match the supplier's state",
    path: ['gstin'],
  });
export type SupplierInput = z.output<typeof supplierInputSchema>;
export type SupplierFormValues = z.input<typeof supplierInputSchema>;

// ---------------------------------------------------------------------------
// Products

const productFields = {
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,32}$/, 'Use 3–32 letters, digits or dashes'),
  barcode: optional(
    z.string().trim().refine(isValidGtin, 'Not a valid EAN/UPC barcode (check the digits)'),
  ),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  description: optionalText(1000),
  category: objectId,
  brand: optionalText(60),
  unit: z.enum(UNITS),
  hsnCode: z
    .string()
    .trim()
    .regex(/^(\d{4}|\d{6}|\d{8})$/, 'HSN code must be 4, 6 or 8 digits'),
  gstRate: z.union(
    GST_RATES.map((r) => z.literal(r)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]],
    {
      error: 'Choose a GST rate',
    },
  ),
  costPrice: paise('Cost price'),
  sellingPrice: paise('Selling price').min(1, 'Selling price is required'),
  mrp: optional(paise('MRP')),
  taxInclusive: z.boolean(),
  reorderLevel: z.number().min(0, 'Cannot be negative'),
  reorderQuantity: z.number().min(0, 'Cannot be negative'),
  preferredSupplier: optional(objectId),
  imageUrl: optional(z.url('Enter a full URL starting with https://')),
  isActive: z.boolean().optional(),
};

const mrpCheck = (p: { mrp?: number; sellingPrice?: number; taxInclusive?: boolean }) =>
  p.mrp === undefined || p.sellingPrice === undefined || !p.taxInclusive || p.sellingPrice <= p.mrp;
const mrpMessage = { message: 'Selling price cannot be more than the MRP', path: ['sellingPrice'] };

export const productCreateSchema = z
  .object({
    ...productFields,
    /** Stock already on the shelf when the product is added; recorded in the stock ledger. */
    openingStock: z.number().min(0, 'Cannot be negative').default(0),
  })
  .refine(mrpCheck, mrpMessage);
export type ProductCreateInput = z.output<typeof productCreateSchema>;
export type ProductFormValues = z.input<typeof productCreateSchema>;

/** Stock is deliberately absent: it only changes through stock movements. */
export const productUpdateSchema = z
  .strictObject(productFields, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Cannot update ${issue.keys.join(', ')}. Stock only changes through a stock adjustment.`
        : undefined,
  })
  .partial()
  .refine(mrpCheck, mrpMessage);
export type ProductUpdateInput = z.output<typeof productUpdateSchema>;

export const PRODUCT_SORTS = [
  'name',
  '-name',
  'sku',
  'stock',
  '-stock',
  'sellingPrice',
  '-sellingPrice',
  '-updatedAt',
] as const;

export const productListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: objectId.optional(),
  supplier: objectId.optional(),
  stock: z.enum(['ok', 'low', 'out']).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  sort: z.enum(PRODUCT_SORTS).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ProductListQuery = z.output<typeof productListQuerySchema>;
