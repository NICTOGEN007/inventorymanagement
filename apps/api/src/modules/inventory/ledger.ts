import type { AdjustmentReason, StockMovementType } from '@ims/shared';
import type { ClientSession, Types } from 'mongoose';
import { ProductModel, StockMovementModel } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';

/**
 * The only way stock changes. Every caller (adjustments, purchase receipts, sales, returns)
 * goes through here, inside its own transaction, so a product's stock and its ledger always
 * move together and stock can never go below zero.
 */

export interface MovementInput {
  product: Types.ObjectId | string;
  type: StockMovementType;
  /** Signed: positive adds stock, negative removes it. */
  quantity: number;
  userId: string;
  occurredAt?: Date;
  ref?: { model: 'Sale' | 'PurchaseOrder' | 'SaleReturn'; id: Types.ObjectId };
  reason?: AdjustmentReason;
  note?: string;
  /** Cost per unit for this movement; defaults to the product's current cost price. */
  unitCost?: number;
}

export interface MovementResult {
  product: { id: string; name: string };
  before: number;
  after: number;
  movementId: Types.ObjectId;
}

export const round3 = (value: number) => Math.round(value * 1000) / 1000;

export async function recordMovement(
  input: MovementInput,
  session: ClientSession,
): Promise<MovementResult> {
  const quantity = round3(input.quantity);
  if (quantity === 0) throw new Error('A stock movement cannot be zero');

  // One atomic update: add the change, but only if enough stock remains for a removal.
  // Rounding in the database keeps loose goods exact (2.5 kg − 0.3 kg = 2.2 kg, not 2.1999…).
  const product = await ProductModel.findOneAndUpdate(
    { _id: input.product, ...(quantity < 0 && { stock: { $gte: -quantity } }) },
    [{ $set: { stock: { $round: [{ $add: ['$stock', quantity] }, 3] } } }],
    {
      session,
      returnDocument: 'after',
      updatePipeline: true,
      timestamps: false,
      projection: { name: 1, stock: 1, costPrice: 1 },
    },
  ).lean();

  if (!product) {
    const existing = await ProductModel.findById(
      input.product,
      { name: 1, stock: 1 },
      { session },
    ).lean();
    if (!existing) throw AppError.notFound('Product not found');
    throw new AppError(
      409,
      `Not enough stock of ${existing.name}: ${existing.stock} available`,
      'INSUFFICIENT_STOCK',
      [
        {
          product: String(existing._id),
          name: existing.name,
          available: existing.stock,
          requested: -quantity,
        },
      ],
    );
  }

  const [movement] = await StockMovementModel.create(
    [
      {
        product: product._id,
        type: input.type,
        quantity,
        balanceAfter: product.stock,
        unitCost: input.unitCost ?? product.costPrice,
        ...(input.ref && { refModel: input.ref.model, refId: input.ref.id }),
        ...(input.reason && { reason: input.reason }),
        ...(input.note && { note: input.note }),
        createdBy: input.userId,
        occurredAt: input.occurredAt ?? new Date(),
      },
    ],
    { session },
  );

  return {
    product: { id: String(product._id), name: product.name },
    before: round3(product.stock - quantity),
    after: product.stock,
    movementId: movement!._id,
  };
}
