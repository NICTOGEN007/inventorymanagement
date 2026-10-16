import { PAYMENT_METHODS, SALE_STATUSES, UNITS } from '@ims/shared';
import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions, gstRate, paise, quantity, signedPaise, stateCode } from './common.js';

/**
 * A line on the invoice. Product details are copied at the time of sale so that
 * later edits to the product never change an issued invoice.
 */
const saleItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    hsnCode: { type: String, required: true },
    unit: { type: String, enum: UNITS, required: true },
    quantity,
    unitPrice: paise,
    taxInclusive: { type: Boolean, required: true },
    gstRate,
    discount: { ...paise, default: 0 },
    taxable: paise,
    cgst: paise,
    sgst: paise,
    igst: paise,
    total: paise,
    /** Cost per unit (excl. GST) at the time of sale, for profit reports. */
    unitCost: paise,
    returnedQuantity: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

const paymentSchema = new Schema(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: paise,
    /** Card approval code / UPI transaction reference. */
    reference: { type: String, trim: true },
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    /** Buyer details as printed on the invoice. */
    customerSnapshot: {
      name: String,
      phone: String,
      gstin: String,
      stateCode: String,
    },
    placeOfSupply: { ...stateCode, required: true },
    interState: { type: Boolean, required: true },
    items: {
      type: [saleItemSchema],
      validate: {
        validator: (items: unknown[]) => items.length > 0,
        message: 'At least one item is required',
      },
    },
    gross: paise,
    discount: paise,
    taxable: paise,
    cgst: paise,
    sgst: paise,
    igst: paise,
    totalTax: paise,
    roundOff: signedPaise,
    grandTotal: paise,
    payments: {
      type: [paymentSchema],
      validate: {
        validator: (p: unknown[]) => p.length > 0,
        message: 'At least one payment is required',
      },
    },
    status: { type: String, enum: SALE_STATUSES, required: true, default: 'completed' },
    cashier: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    soldAt: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true, maxlength: 500 },
    /** The till's own reference for this bill, so a resent request cannot bill twice. */
    clientRef: { type: String, trim: true },
  },
  baseOptions,
);

saleSchema.index({ soldAt: -1 });
saleSchema.index({ customer: 1, soldAt: -1 });
// Daily per-product demand aggregation for reports and forecasting.
saleSchema.index({ 'items.product': 1, soldAt: 1 });
saleSchema.index(
  { clientRef: 1 },
  { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } },
);

saleSchema.pre('validate', function () {
  const paid = this.payments.reduce((sum, p) => sum + p.amount, 0);
  if (paid !== this.grandTotal) {
    this.invalidate(
      'payments',
      `Payments (${paid}) must equal the grand total (${this.grandTotal})`,
    );
  }
});

export type Sale = InferSchemaType<typeof saleSchema>;
export const SaleModel = model('Sale', saleSchema);
