import { STOCK_MOVEMENT_TYPES } from '@ims/shared';
import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions } from './common.js';

/**
 * The stock ledger. Every change to a product's stock is one immutable entry here,
 * so current stock can always be explained and audited.
 */
const stockMovementSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    /** Signed change: positive adds stock, negative removes it. */
    quantity: {
      type: Number,
      required: true,
      validate: { validator: (v: number) => v !== 0, message: 'Quantity cannot be zero' },
    },
    /** Stock on hand right after this movement. */
    balanceAfter: { type: Number, required: true, min: 0 },
    /** Cost per unit at the time (paise, excl. GST), for stock valuation. */
    unitCost: { type: Number, min: 0 },
    /** The document that caused the movement, if any. */
    refModel: { type: String, enum: ['Sale', 'PurchaseOrder', 'SaleReturn'] },
    refId: { type: Schema.Types.ObjectId, refPath: 'refModel' },
    note: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Business time of the movement (may differ from createdAt for back-dated entries). */
    occurredAt: { type: Date, required: true, default: Date.now },
  },
  baseOptions,
);

stockMovementSchema.index({ product: 1, occurredAt: -1 });
stockMovementSchema.index({ type: 1, occurredAt: -1 });
stockMovementSchema.index({ refModel: 1, refId: 1 });

stockMovementSchema.pre('validate', function () {
  if (this.type === 'adjustment' && !this.note) {
    this.invalidate('note', 'A reason is required for stock adjustments');
  }
});

export type StockMovement = InferSchemaType<typeof stockMovementSchema>;
export const StockMovementModel = model('StockMovement', stockMovementSchema);
