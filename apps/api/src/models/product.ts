import { UNITS } from '@ims/shared';
import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { baseOptions, gstRate, paise } from './common.js';

const productSchema = new Schema(
  {
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      match: [/^[A-Z0-9-]{3,32}$/, 'SKU may contain only letters, digits and dashes (3-32)'],
    },
    /** EAN-13 / UPC / internal barcode. Optional but unique when present. */
    barcode: { type: String, trim: true, match: [/^[0-9]{8,14}$/, 'Barcode must be 8-14 digits'] },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    brand: { type: String, trim: true, maxlength: 60 },
    unit: { type: String, enum: UNITS, required: true, default: 'pcs' },
    /** Harmonised System of Nomenclature code printed on GST invoices (4, 6 or 8 digits). */
    hsnCode: {
      type: String,
      required: true,
      match: [/^([0-9]{4}|[0-9]{6}|[0-9]{8})$/, 'Invalid HSN code'],
    },
    gstRate,
    /** Purchase cost per unit, excluding GST (input tax is claimed back). */
    costPrice: paise,
    /** Selling price per unit; includes GST when `taxInclusive` is true. */
    sellingPrice: paise,
    /** Maximum retail price printed on the pack, if any. */
    mrp: { ...paise, required: false },
    taxInclusive: { type: Boolean, default: true },
    /** Current stock on hand. Only changed together with a StockMovement. */
    stock: { type: Number, required: true, default: 0, min: [0, 'Stock cannot go negative'] },
    /** Raise a low-stock alert when stock falls to or below this level. */
    reorderLevel: { type: Number, required: true, min: 0, default: 10 },
    /** Default quantity to order when restocking. */
    reorderQuantity: { type: Number, required: true, min: 0, default: 50 },
    /** The supplier sells it in packs (cartons, crates) of this many; restock orders round up to it. */
    packSize: {
      type: Number,
      required: true,
      min: [1, 'Pack size must be at least 1'],
      default: 1,
      validate: { validator: Number.isInteger, message: 'Pack size must be a whole number' },
    },
    preferredSupplier: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    imageUrl: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  baseOptions,
);

productSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } },
);
productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ name: 'text', brand: 'text', sku: 'text' });

productSchema.virtual('isLowStock').get(function () {
  return this.stock <= this.reorderLevel;
});

productSchema.pre('validate', function () {
  if (this.mrp != null && this.taxInclusive && this.sellingPrice > this.mrp) {
    this.invalidate('sellingPrice', 'Selling price cannot exceed MRP');
  }
});

export type Product = InferSchemaType<typeof productSchema>;
export type ProductDocument = HydratedDocument<Product>;
export const ProductModel = model('Product', productSchema);
