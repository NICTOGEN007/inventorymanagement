import {
  allowsFractions,
  calculateGst,
  financialYear,
  formatDocumentNumber,
  istDateKey,
  istDayRange,
  OPEN_PURCHASE_ORDER_STATUSES,
  type GstRate,
  type Paginated,
  type PurchaseOrderDto,
  type PurchaseOrderInput,
  type PurchaseOrderListQuery,
  type PurchaseOrderStatus,
  type PurchaseOrderSummaryDto,
  type ReceiveGoodsInput,
  type StateCode,
} from '@ims/shared';
import mongoose, { type ClientSession, type Types } from 'mongoose';
import {
  nextSequence,
  ProductModel,
  PurchaseOrderModel,
  SupplierModel,
  UserModel,
  type PurchaseOrder,
} from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { containsPattern, iso, toObjectId } from '../../utils/query.js';
import { recordMovement, round3 } from '../inventory/ledger.js';
import { getShopSettings } from '../settings/service.js';

type PoDoc = PurchaseOrder & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
const DAY_MS = 86_400_000;

const fieldError = (path: (string | number)[], message: string) =>
  AppError.badRequest(message, [{ path, message }]);

/** Midnight IST at the start of a calendar day, `days` from now. */
function istDayFromNow(days: number): Date {
  return istDayRange(istDateKey(new Date(Date.now() + days * DAY_MS))).start;
}

/** Expected at midnight starting that day, so it is overdue once that whole day has passed. */
const isOverdue = (status: PurchaseOrderStatus, expectedAt?: Date | null) =>
  OPEN_PURCHASE_ORDER_STATUSES.includes(status) &&
  !!expectedAt &&
  Date.now() >= expectedAt.getTime() + DAY_MS;

async function activeSupplier(id: string, session: ClientSession) {
  const supplier = await SupplierModel.findById(toObjectId(id, 'Supplier not found'), null, {
    session,
  }).lean();
  if (!supplier) throw fieldError(['supplier'], 'Supplier not found');
  if (supplier.isActive === false) throw fieldError(['supplier'], `${supplier.name} is inactive`);
  return supplier;
}

/** Validates the lines and works out GST for each; CGST+SGST or IGST depends on the supplier's state. */
async function buildItems(
  items: PurchaseOrderInput['items'],
  interState: boolean,
  session: ClientSession,
) {
  const products = await ProductModel.find(
    { _id: { $in: items.map((i) => toObjectId(i.product)) } },
    { name: 1, unit: 1, gstRate: 1, isActive: 1 },
    { session },
  ).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  return items.map((item, index) => {
    const product = byId.get(item.product);
    if (!product) throw fieldError(['items', index, 'product'], 'Product not found');
    if (product.isActive === false)
      throw fieldError(['items', index, 'product'], `${product.name} is inactive`);
    if (!allowsFractions(product.unit) && !Number.isInteger(item.quantity)) {
      throw fieldError(
        ['items', index, 'quantity'],
        `${product.name} is ordered in whole ${product.unit}`,
      );
    }
    const gst = calculateGst(
      Math.round(item.unitCost * item.quantity),
      product.gstRate as GstRate,
      interState,
    );
    return {
      product: product._id,
      name: product.name,
      quantity: item.quantity,
      receivedQuantity: 0,
      unitCost: item.unitCost,
      gstRate: product.gstRate,
      taxable: gst.taxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total: gst.total,
    };
  });
}

function sumTotals(
  items: { taxable: number; cgst: number; sgst: number; igst: number; total: number }[],
) {
  const sum = (key: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'total') =>
    items.reduce((acc, i) => acc + i[key], 0);
  return {
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    total: sum('total'),
  };
}

async function orderContents(input: PurchaseOrderInput, session: ClientSession) {
  // One operation at a time: a transaction's session cannot run queries in parallel.
  const settings = await getShopSettings(session);
  const supplier = await activeSupplier(input.supplier, session);
  const interState = supplier.stateCode !== settings.stateCode;
  const items = await buildItems(input.items, interState, session);
  return { settings, supplier, interState, items, totals: sumTotals(items) };
}

function placement(input: PurchaseOrderInput, leadTimeDays: number) {
  const expectedAt = input.expectedAt ? istDayRange(input.expectedAt).start : undefined;
  if (!input.place) return { status: 'draft' as const, expectedAt };
  return {
    status: 'ordered' as const,
    orderedAt: new Date(),
    expectedAt: expectedAt ?? istDayFromNow(leadTimeDays),
  };
}

export async function createPurchaseOrder(
  input: PurchaseOrderInput,
  userId: string,
): Promise<PurchaseOrderDto> {
  const id = await mongoose.connection.transaction(async (session) => {
    const { settings, supplier, interState, items, totals } = await orderContents(input, session);
    const now = new Date();
    const seq = await nextSequence(`purchaseOrder:${financialYear(now)}`, session);
    const [po] = await PurchaseOrderModel.create(
      [
        {
          poNumber: formatDocumentNumber(settings.purchaseOrderPrefix, now, seq),
          supplier: supplier._id,
          interState,
          items,
          ...totals,
          ...placement(input, supplier.leadTimeDays),
          notes: input.notes,
          createdBy: userId,
        },
      ],
      { session },
    );
    return po!._id;
  });
  return getPurchaseOrder(String(id));
}

async function findForUpdate(id: string, session: ClientSession) {
  const po = await PurchaseOrderModel.findById(toObjectId(id, 'Purchase order not found'), null, {
    session,
  });
  if (!po) throw AppError.notFound('Purchase order not found');
  return po;
}

/** Only drafts can be edited; placed orders have gone to the supplier. */
export async function updateDraft(
  id: string,
  input: PurchaseOrderInput,
): Promise<PurchaseOrderDto> {
  await mongoose.connection.transaction(async (session) => {
    const po = await findForUpdate(id, session);
    if (po.status !== 'draft') throw AppError.conflict('Only draft orders can be edited');
    const { supplier, interState, items, totals } = await orderContents(input, session);
    po.set({
      supplier: supplier._id,
      interState,
      items,
      ...totals,
      ...placement(input, supplier.leadTimeDays),
      notes: input.notes,
    });
    await po.save({ session });
  });
  return getPurchaseOrder(id);
}

export async function placeOrder(id: string): Promise<PurchaseOrderDto> {
  await mongoose.connection.transaction(async (session) => {
    const po = await findForUpdate(id, session);
    if (po.status !== 'draft') throw AppError.conflict('This order has already been placed');
    const supplier = await activeSupplier(String(po.supplier), session);
    po.status = 'ordered';
    po.orderedAt = new Date();
    po.expectedAt ??= istDayFromNow(supplier.leadTimeDays);
    await po.save({ session });
  });
  return getPurchaseOrder(id);
}

/**
 * Records a delivery: adds the goods to stock through the ledger, updates each product's cost
 * to the weighted average of old stock and new goods, and moves the order to partly or fully
 * received. All in one transaction; concurrent receipts of the same order are serialised by
 * MongoDB, so goods can never be received twice.
 */
export async function receiveGoods(
  id: string,
  input: ReceiveGoodsInput,
  userId: string,
): Promise<PurchaseOrderDto> {
  await mongoose.connection.transaction(async (session) => {
    const po = await findForUpdate(id, session);
    if (!OPEN_PURCHASE_ORDER_STATUSES.includes(po.status)) {
      throw AppError.conflict(
        po.status === 'draft'
          ? 'Place the order before receiving goods'
          : 'This order is no longer open',
      );
    }
    const units = new Map(
      (
        await ProductModel.find(
          { _id: { $in: po.items.map((i) => i.product) } },
          { unit: 1 },
          { session },
        ).lean()
      ).map((p) => [String(p._id), p.unit]),
    );
    const now = new Date();

    for (const [index, received] of input.items.entries()) {
      const line = po.items.find((i) => String(i.product) === received.product);
      if (!line) throw fieldError(['items', index, 'product'], 'This product is not on the order');
      const remaining = round3(line.quantity - line.receivedQuantity);
      if (received.quantity > remaining + 1e-9) {
        throw fieldError(
          ['items', index, 'quantity'],
          `Only ${remaining} of ${line.name} still to arrive`,
        );
      }
      const unit = units.get(received.product);
      if (unit && !allowsFractions(unit) && !Number.isInteger(received.quantity)) {
        throw fieldError(['items', index, 'quantity'], `${line.name} is received in whole ${unit}`);
      }

      const before = await ProductModel.findById(
        line.product,
        { stock: 1, costPrice: 1 },
        { session },
      ).lean();
      if (!before) throw fieldError(['items', index, 'product'], `${line.name} no longer exists`);
      await recordMovement(
        {
          product: line.product,
          type: 'purchase',
          quantity: received.quantity,
          unitCost: line.unitCost,
          ref: { model: 'PurchaseOrder', id: po._id },
          userId,
          occurredAt: now,
        },
        session,
      );
      // Weighted average cost: what the shelf as a whole cost to buy.
      const stockBefore = Math.max(0, before.stock);
      const costPrice =
        stockBefore > 0
          ? Math.round(
              (stockBefore * before.costPrice + received.quantity * line.unitCost) /
                (stockBefore + received.quantity),
            )
          : line.unitCost;
      await ProductModel.updateOne({ _id: line.product }, { $set: { costPrice } }, { session });
      line.receivedQuantity = round3(line.receivedQuantity + received.quantity);
    }

    const complete = po.items.every((i) => i.receivedQuantity >= i.quantity - 1e-9);
    po.status = complete ? 'received' : 'partially_received';
    if (complete) po.receivedAt = now;
    if (input.supplierInvoiceNumber) po.supplierInvoiceNumber = input.supplierInvoiceNumber;
    po.receipts.push({
      receivedAt: now,
      receivedBy: userId,
      supplierInvoiceNumber: input.supplierInvoiceNumber,
      note: input.note,
      items: input.items.map((i) => ({ product: i.product, quantity: i.quantity })),
    });
    await po.save({ session });
  });
  return getPurchaseOrder(id);
}

/** Drafts and untouched orders are cancelled; a partly received order is closed short. */
export async function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrderDto> {
  await mongoose.connection.transaction(async (session) => {
    const po = await findForUpdate(id, session);
    if (po.status === 'draft' || po.status === 'ordered') po.status = 'cancelled';
    else if (po.status === 'partially_received') po.status = 'closed';
    else throw AppError.conflict('This order is already finished');
    po.cancelledAt = new Date();
    po.cancelReason = reason;
    await po.save({ session });
  });
  return getPurchaseOrder(id);
}

function toSummary(po: PoDoc, supplierName: string): PurchaseOrderSummaryDto {
  return {
    id: String(po._id),
    poNumber: po.poNumber,
    supplier: { id: String(po.supplier), name: supplierName },
    status: po.status,
    interState: po.interState,
    itemCount: po.items.length,
    taxable: po.taxable,
    cgst: po.cgst,
    sgst: po.sgst,
    igst: po.igst,
    total: po.total,
    ...(po.orderedAt && { orderedAt: iso(po.orderedAt) }),
    ...(po.expectedAt && { expectedAt: iso(po.expectedAt) }),
    overdue: isOverdue(po.status, po.expectedAt),
    createdAt: iso(po.createdAt),
  };
}

export async function listPurchaseOrders(
  query: PurchaseOrderListQuery,
): Promise<Paginated<PurchaseOrderSummaryDto>> {
  const filter: mongoose.QueryFilter<Record<string, unknown>> = {};
  if (query.status === 'open') filter.status = { $in: [...OPEN_PURCHASE_ORDER_STATUSES] };
  else if (query.status) filter.status = query.status;
  if (query.supplier) filter.supplier = toObjectId(query.supplier, 'Supplier not found');
  if (query.search) filter.poNumber = containsPattern(query.search);

  const [orders, total] = await Promise.all([
    PurchaseOrderModel.find(filter, { receipts: 0 })
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<PoDoc[]>(),
    PurchaseOrderModel.countDocuments(filter),
  ]);
  const suppliers = await SupplierModel.find(
    { _id: { $in: orders.map((o) => o.supplier) } },
    { name: 1 },
  ).lean();
  const names = new Map(suppliers.map((s) => [String(s._id), s.name]));
  return {
    data: orders.map((o) => toSummary(o, names.get(String(o.supplier)) ?? 'Unknown')),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDto> {
  const po = await PurchaseOrderModel.findById(
    toObjectId(id, 'Purchase order not found'),
  ).lean<PoDoc>();
  if (!po) throw AppError.notFound('Purchase order not found');

  const userIds = [po.createdBy, ...po.receipts.map((r) => r.receivedBy)].filter(Boolean);
  const [supplier, products, users] = await Promise.all([
    SupplierModel.findById(po.supplier).lean(),
    ProductModel.find({ _id: { $in: po.items.map((i) => i.product) } }, { sku: 1, unit: 1 }).lean(),
    UserModel.find({ _id: { $in: userIds } }, { name: 1 }).lean(),
  ]);
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const lineName = new Map(po.items.map((i) => [String(i.product), i.name]));
  const userName = new Map(users.map((u) => [String(u._id), u.name]));
  const userRef = (uid?: Types.ObjectId | null) =>
    uid ? { id: String(uid), name: userName.get(String(uid)) ?? 'Unknown' } : undefined;

  const createdBy = userRef(po.createdBy);
  return {
    ...toSummary(po, supplier?.name ?? 'Unknown'),
    supplierDetails: {
      name: supplier?.name ?? 'Unknown',
      ...(supplier?.gstin && { gstin: supplier.gstin }),
      stateCode: (supplier?.stateCode ?? '29') as StateCode,
      ...(supplier?.phone && { phone: supplier.phone }),
      ...(supplier?.email && { email: supplier.email }),
      leadTimeDays: supplier?.leadTimeDays ?? 0,
    },
    items: po.items.map((i) => {
      const product = productById.get(String(i.product));
      return {
        product: {
          id: String(i.product),
          name: i.name,
          sku: product?.sku ?? '',
          unit: product?.unit ?? 'pcs',
        },
        quantity: i.quantity,
        receivedQuantity: i.receivedQuantity,
        remainingQuantity: round3(Math.max(0, i.quantity - i.receivedQuantity)),
        unitCost: i.unitCost,
        gstRate: i.gstRate,
        taxable: i.taxable,
        cgst: i.cgst,
        sgst: i.sgst,
        igst: i.igst,
        total: i.total,
      };
    }),
    receipts: po.receipts.map((r) => {
      const receivedBy = userRef(r.receivedBy);
      return {
        receivedAt: iso(r.receivedAt),
        ...(receivedBy && { receivedBy }),
        ...(r.supplierInvoiceNumber && { supplierInvoiceNumber: r.supplierInvoiceNumber }),
        ...(r.note && { note: r.note }),
        items: r.items.map((i) => ({
          product: { id: String(i.product), name: lineName.get(String(i.product)) ?? 'Unknown' },
          quantity: i.quantity,
        })),
      };
    }),
    ...(po.notes && { notes: po.notes }),
    ...(po.receivedAt && { receivedAt: iso(po.receivedAt) }),
    ...(po.cancelledAt && { cancelledAt: iso(po.cancelledAt) }),
    ...(po.cancelReason && { cancelReason: po.cancelReason }),
    ...(createdBy && { createdBy }),
  };
}
