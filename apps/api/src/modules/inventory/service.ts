import {
  allowsFractions,
  istDayRange,
  REDUCING_REASONS,
  type AdjustmentResult,
  type InventorySummary,
  type MovementListQuery,
  type Paginated,
  type StockAdjustmentInput,
  type StockMovementDto,
} from '@ims/shared';
import mongoose, { type Types } from 'mongoose';
import {
  CategoryModel,
  ProductModel,
  PurchaseOrderModel,
  SaleModel,
  SaleReturnModel,
  StockMovementModel,
  UserModel,
} from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { iso, toObjectId } from '../../utils/query.js';
import { recordMovement, round3 } from './ledger.js';

/**
 * Applies a stock adjustment (stock count or write-off) for several products at once.
 * All lines succeed or none do.
 */
export async function adjustStock(
  input: StockAdjustmentInput,
  userId: string,
): Promise<AdjustmentResult> {
  return mongoose.connection.transaction(async (session) => {
    const ids = input.items.map((i) => toObjectId(i.product, 'Product not found'));
    const products = await ProductModel.find(
      { _id: { $in: ids } },
      { name: 1, unit: 1, stock: 1 },
      { session },
    ).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const result: AdjustmentResult = { adjusted: [], unchanged: [] };
    for (const [index, item] of input.items.entries()) {
      const product = byId.get(item.product);
      const field = (message: string) =>
        AppError.badRequest(message, [{ path: ['items', index, 'quantity'], message }]);
      if (!product)
        throw AppError.badRequest('Product not found', [
          { path: ['items', index, 'product'], message: 'Product not found' },
        ]);
      if (!allowsFractions(product.unit) && !Number.isInteger(item.quantity)) {
        throw field(`${product.name} is counted in whole ${product.unit}`);
      }

      const change = item.mode === 'set' ? round3(item.quantity - product.stock) : item.quantity;
      const ref = { id: String(product._id), name: product.name };
      if (change === 0) {
        result.unchanged.push(ref);
        continue;
      }
      if (REDUCING_REASONS.includes(input.reason) && change > 0) {
        throw field(
          `The count for ${product.name} is higher than current stock; use "Stock count correction"`,
        );
      }
      if (product.stock + change < 0) {
        throw field(`Only ${product.stock} ${product.unit} of ${product.name} in stock`);
      }

      const moved = await recordMovement(
        {
          product: product._id,
          type: 'adjustment',
          quantity: change,
          reason: input.reason,
          note: input.note,
          userId,
        },
        session,
      );
      result.adjusted.push({ product: ref, before: moved.before, after: moved.after, change });
    }
    return result;
  });
}

type RefModel = 'Sale' | 'PurchaseOrder' | 'SaleReturn';

/** Looks up invoice, PO and return numbers for a page of movements in three queries. */
async function documentNumbers(
  movements: { refModel?: string | null; refId?: Types.ObjectId | null }[],
) {
  const ids = (model: RefModel) =>
    movements.filter((m) => m.refModel === model && m.refId).map((m) => m.refId!);
  const [sales, orders, returns] = await Promise.all([
    SaleModel.find({ _id: { $in: ids('Sale') } }, { invoiceNumber: 1 }).lean(),
    PurchaseOrderModel.find({ _id: { $in: ids('PurchaseOrder') } }, { poNumber: 1 }).lean(),
    SaleReturnModel.find({ _id: { $in: ids('SaleReturn') } }, { returnNumber: 1 }).lean(),
  ]);
  return new Map<string, string>([
    ...sales.map((s) => [String(s._id), s.invoiceNumber] as const),
    ...orders.map((o) => [String(o._id), o.poNumber] as const),
    ...returns.map((r) => [String(r._id), r.returnNumber] as const),
  ]);
}

export async function listMovements(
  query: MovementListQuery,
  { includeCost }: { includeCost: boolean },
): Promise<Paginated<StockMovementDto>> {
  const filter: mongoose.QueryFilter<Record<string, unknown>> = {};
  if (query.product) filter.product = toObjectId(query.product, 'Product not found');
  if (query.type) filter.type = query.type;
  if (query.from || query.to) {
    filter.occurredAt = {
      ...(query.from && { $gte: istDayRange(query.from).start }),
      ...(query.to && { $lt: istDayRange(query.to).end }),
    };
  }

  const [movements, total] = await Promise.all([
    StockMovementModel.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean(),
    StockMovementModel.countDocuments(filter),
  ]);

  const [products, users, numbers] = await Promise.all([
    ProductModel.find(
      { _id: { $in: movements.map((m) => m.product) } },
      { name: 1, sku: 1, unit: 1 },
    ).lean(),
    UserModel.find(
      { _id: { $in: movements.flatMap((m) => (m.createdBy ? [m.createdBy] : [])) } },
      { name: 1 },
    ).lean(),
    documentNumbers(movements),
  ]);
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const userName = new Map(users.map((u) => [String(u._id), u.name]));

  const data = movements.map((m): StockMovementDto => {
    const product = productById.get(String(m.product));
    const number = m.refId ? numbers.get(String(m.refId)) : undefined;
    return {
      id: String(m._id),
      product: {
        id: String(m.product),
        name: product?.name ?? 'Deleted product',
        sku: product?.sku ?? '',
        unit: product?.unit ?? 'pcs',
      },
      type: m.type,
      quantity: m.quantity,
      balanceAfter: m.balanceAfter,
      ...(includeCost &&
        m.unitCost != null && { unitCost: m.unitCost, value: Math.round(m.quantity * m.unitCost) }),
      ...(m.reason && { reason: m.reason }),
      ...(m.note && { note: m.note }),
      ...(m.refModel &&
        m.refId &&
        number && { reference: { kind: m.refModel, id: String(m.refId), number } }),
      ...(m.createdBy && {
        createdBy: {
          id: String(m.createdBy),
          name: userName.get(String(m.createdBy)) ?? 'Unknown',
        },
      }),
      occurredAt: iso(m.occurredAt),
    };
  });
  return { data, page: query.page, pageSize: query.pageSize, total };
}

interface ValueRow {
  _id: Types.ObjectId;
  costValue: number;
  retailValue: number;
  products: number;
  lowStock: number;
  outOfStock: number;
}

/** Stock value at cost and at selling price, overall and per category, plus recent write-offs. */
export async function inventorySummary(): Promise<InventorySummary> {
  const rows = await ProductModel.aggregate<ValueRow>([
    { $match: { isActive: true } },
    {
      $group: {
        _id: '$category',
        costValue: { $sum: { $multiply: ['$stock', '$costPrice'] } },
        retailValue: { $sum: { $multiply: ['$stock', '$sellingPrice'] } },
        products: { $sum: 1 },
        lowStock: {
          $sum: {
            $cond: [
              { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$reorderLevel'] }] },
              1,
              0,
            ],
          },
        },
        outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
      },
    },
  ]);
  const categories = await CategoryModel.find(
    { _id: { $in: rows.map((r) => r._id) } },
    { name: 1 },
  ).lean();
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));

  const since = new Date(Date.now() - 30 * 86_400_000);
  const writeOffs = await StockMovementModel.aggregate<{
    _id: 'damaged' | 'expired' | 'lost';
    value: number;
  }>([
    {
      $match: {
        type: 'adjustment',
        reason: { $in: [...REDUCING_REASONS] },
        occurredAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: '$reason',
        value: { $sum: { $multiply: [{ $abs: '$quantity' }, '$unitCost'] } },
      },
    },
  ]);

  const totals = rows.reduce(
    (acc, r) => ({
      costValue: acc.costValue + r.costValue,
      retailValue: acc.retailValue + r.retailValue,
      products: acc.products + r.products,
      lowStock: acc.lowStock + r.lowStock,
      outOfStock: acc.outOfStock + r.outOfStock,
    }),
    { costValue: 0, retailValue: 0, products: 0, lowStock: 0, outOfStock: 0 },
  );

  return {
    ...totals,
    costValue: Math.round(totals.costValue),
    retailValue: Math.round(totals.retailValue),
    byCategory: rows
      .map((r) => ({
        category: { id: String(r._id), name: categoryName.get(String(r._id)) ?? 'Unknown' },
        costValue: Math.round(r.costValue),
        retailValue: Math.round(r.retailValue),
        products: r.products,
        lowStock: r.lowStock,
        outOfStock: r.outOfStock,
      }))
      .sort((a, b) => b.costValue - a.costValue),
    writeOffs30d: {
      value: Math.round(writeOffs.reduce((sum, w) => sum + w.value, 0)),
      byReason: writeOffs
        .map((w) => ({ reason: w._id, value: Math.round(w.value) }))
        .sort((a, b) => b.value - a.value),
    },
  };
}
