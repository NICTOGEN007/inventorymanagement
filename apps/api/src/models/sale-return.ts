import { PAYMENT_METHODS, UNITS } from '@ims/shared';
import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions, gstRate, paise, quantity, signedPaise, stateCode } from './common.js';

const returnItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    hsnCode: { type: String, required: true },
    unit: { type: String, enum: UNITS, required: true },
    gstRate,
    quantity,
    /** Cost per unit (excl. GST) from the sale, for the stock ledger and profit reports. */
    unitCost: paise,
    taxable: paise,
    cgst: paise,
    sgst: paise,
    igst: paise,
    /** Amount refunded for this line (taxable + tax). */
    total: paise,
    /** Returned goods in sellable condition go back to stock. */
    restock: { type: Boolean, default: true },
  },
  { _id: false },
);

/** A customer return against an earlier sale (credit note). */
const saleReturnSchema = new Schema(
  {
    returnNumber: { type: String, required: true, unique: true },
    sale: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    invoiceNumber: { type: String, required: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    /** Buyer as on the invoice, so the credit note matches it. */
    customerName: { type: String, trim: true },
    placeOfSupply: { ...stateCode, required: true },
    interState: { type: Boolean, required: true },
    items: {
      type: [returnItemSchema],
      validate: {
        validator: (items: unknown[]) => items.length > 0,
        message: 'At least one item is required',
      },
    },
    taxable: paise,
    cgst: paise,
    sgst: paise,
    igst: paise,
    totalTax: paise,
    /** Adjustment to reach a whole rupee. */
    roundOff: { ...signedPaise, default: 0 },
    totalRefund: paise,
    refundMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    /** UPI transaction id or card reversal reference. */
    refundReference: { type: String, trim: true },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    returnedAt: { type: Date, required: true, default: Date.now },
    /** The till's own reference, so a resent request cannot refund twice. */
    clientRef: { type: String, trim: true },
  },
  baseOptions,
);

saleReturnSchema.index({ sale: 1 });
saleReturnSchema.index({ returnedAt: -1 });
saleReturnSchema.index({ customer: 1, returnedAt: -1 });
saleReturnSchema.index(
  { clientRef: 1 },
  { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } },
);

export type SaleReturn = InferSchemaType<typeof saleReturnSchema>;
export const SaleReturnModel = model('SaleReturn', saleReturnSchema);
