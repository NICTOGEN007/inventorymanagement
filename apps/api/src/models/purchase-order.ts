import { PURCHASE_ORDER_STATUSES } from '@ims/shared';
import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions, gstRate, paise, quantity } from './common.js';

const purchaseOrderItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    quantity,
    receivedQuantity: { type: Number, required: true, default: 0, min: 0 },
    /** Cost per unit excluding GST. */
    unitCost: paise,
    gstRate,
    taxable: paise,
    cgst: paise,
    sgst: paise,
    igst: paise,
    total: paise,
  },
  { _id: false },
);

/** One delivery against the order; an order can arrive in several. */
const receiptSchema = new Schema(
  {
    receivedAt: { type: Date, required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    supplierInvoiceNumber: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 300 },
    items: [
      new Schema(
        {
          product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
          quantity,
        },
        { _id: false },
      ),
    ],
  },
  { _id: false },
);

const purchaseOrderSchema = new Schema(
  {
    poNumber: { type: String, required: true, unique: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    status: { type: String, enum: PURCHASE_ORDER_STATUSES, required: true, default: 'draft' },
    items: {
      type: [purchaseOrderItemSchema],
      validate: {
        validator: (items: unknown[]) => items.length > 0,
        message: 'At least one item is required',
      },
    },
    interState: { type: Boolean, required: true },
    taxable: paise,
    cgst: paise,
    sgst: paise,
    igst: paise,
    total: paise,
    orderedAt: Date,
    expectedAt: Date,
    /** When the last outstanding goods arrived. */
    receivedAt: Date,
    /** Supplier's bill number from the latest delivery. */
    supplierInvoiceNumber: { type: String, trim: true },
    receipts: { type: [receiptSchema], default: [] },
    cancelledAt: Date,
    cancelReason: { type: String, trim: true, maxlength: 300 },
    notes: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  baseOptions,
);

purchaseOrderSchema.index({ supplier: 1, orderedAt: -1 });
purchaseOrderSchema.index({ status: 1, expectedAt: 1 });
purchaseOrderSchema.index({ createdAt: -1 });
purchaseOrderSchema.index({ 'items.product': 1 });

export type PurchaseOrder = InferSchemaType<typeof purchaseOrderSchema>;
export const PurchaseOrderModel = model('PurchaseOrder', purchaseOrderSchema);
