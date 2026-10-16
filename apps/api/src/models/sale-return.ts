import { PAYMENT_METHODS } from '@ims/shared';
import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions, paise, quantity } from './common.js';

const returnItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    quantity,
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
    totalRefund: paise,
    refundMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    returnedAt: { type: Date, required: true, default: Date.now },
  },
  baseOptions,
);

saleReturnSchema.index({ sale: 1 });
saleReturnSchema.index({ returnedAt: -1 });

export type SaleReturn = InferSchemaType<typeof saleReturnSchema>;
export const SaleReturnModel = model('SaleReturn', saleReturnSchema);
