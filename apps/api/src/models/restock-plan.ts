import { RESTOCK_PLAN_SOURCES, RESTOCK_PLAN_STATUSES, UNITS } from '@ims/shared';
import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions, gstRate, paise, quantity } from './common.js';

/**
 * One line of a restock plan, with what the shop looked like when the plan was made, so the
 * owner sees the numbers the suggestion was based on.
 */
const restockPlanItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    sku: { type: String, required: true },
    unit: { type: String, enum: UNITS, required: true },
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    stock: { type: Number, required: true, min: 0 },
    onOrder: { type: Number, required: true, min: 0 },
    dailyDemand: { type: Number, required: true, min: 0 },
    /** null: lasts more than 120 days. */
    daysUntilStockout: { type: Number, default: null },
    packSize: { type: Number, required: true, min: 1 },
    suggestedQuantity: { type: Number, required: true, min: 0 },
    /** What will be ordered; the owner can change it. */
    quantity,
    /** Cost per unit excluding GST. */
    unitCost: paise,
    gstRate,
    reasons: { type: [String], default: [] },
  },
  { _id: false },
);

const restockPlanSchema = new Schema(
  {
    planNumber: { type: String, required: true, unique: true },
    status: { type: String, enum: RESTOCK_PLAN_STATUSES, required: true, default: 'draft' },
    source: { type: String, enum: RESTOCK_PLAN_SOURCES, required: true, default: 'manual' },
    /** Spending limit including GST, if one was given. */
    budget: { ...paise, required: false },
    /** Only this supplier's products, if one was chosen. */
    supplier: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    items: { type: [restockPlanItemSchema], default: [] },
    skipped: {
      type: [
        new Schema(
          {
            product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
            name: { type: String, required: true },
            reason: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    expiresAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    confirmedAt: Date,
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** One per supplier, placed when the plan was confirmed. */
    purchaseOrders: [{ type: Schema.Types.ObjectId, ref: 'PurchaseOrder' }],
    cancelledAt: Date,
    expiredReason: { type: String, trim: true, maxlength: 300 },
  },
  baseOptions,
);

restockPlanSchema.index({ status: 1, createdAt: -1 });
restockPlanSchema.index({ createdAt: -1 });

export type RestockPlan = InferSchemaType<typeof restockPlanSchema>;
export const RestockPlanModel = model('RestockPlan', restockPlanSchema);
