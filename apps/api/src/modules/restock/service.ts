import {
  allowsFractions,
  calculateGst,
  financialYear,
  formatDocumentNumber,
  RESTOCK_PLAN_TTL_HOURS,
  type ForecastItemDto,
  type GstRate,
  type Paginated,
  type RestockAlertDto,
  type RestockPlanCreateInput,
  type RestockPlanDto,
  type RestockPlanGroupDto,
  type RestockPlanListQuery,
  type RestockPlanSource,
  type RestockPlanSummaryDto,
  type RestockPlanUpdateInput,
} from '@ims/shared';
import mongoose, { type Types } from 'mongoose';
import {
  nextSequence,
  PurchaseOrderModel,
  RestockPlanModel,
  SupplierModel,
  UserModel,
  type RestockPlan,
} from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { iso, toObjectId } from '../../utils/query.js';
import { forecastItemsFor, itemsToReorder } from '../forecasting/service.js';
import { onOrderFor } from '../products/service.js';
import { insertPurchaseOrder } from '../purchase-orders/service.js';
import { getShopSettings } from '../settings/service.js';

/**
 * Restock plans: the forecasts turned into a draft order list, grouped by supplier. People (and,
 * later, the AI assistant) can prepare and edit drafts, but only a person with purchases:manage
 * can confirm one, which places the purchase orders.
 */

type PlanDoc = RestockPlan & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
type PlanItem = RestockPlan['items'][number];

const PLAN_PREFIX = 'RST';
const TTL_MS = RESTOCK_PLAN_TTL_HOURS * 3_600_000;

const fieldError = (path: (string | number)[], message: string) =>
  AppError.badRequest(message, [{ path, message }]);

/** Drafts are only good for a day; older ones expire the next time plans are looked at. */
async function expireStale() {
  await RestockPlanModel.updateMany(
    { status: 'draft', expiresAt: { $lte: new Date() } },
    {
      $set: {
        status: 'expired',
        expiredReason: `Not confirmed within ${RESTOCK_PLAN_TTL_HOURS} hours`,
      },
    },
  );
}

async function supplierStates(ids: Types.ObjectId[]) {
  const [settings, suppliers] = await Promise.all([
    getShopSettings(),
    SupplierModel.find({ _id: { $in: ids } }, { name: 1, leadTimeDays: 1, stateCode: 1 }).lean(),
  ]);
  return {
    settings,
    suppliers: new Map(
      suppliers.map((s) => [
        String(s._id),
        { ...s, interState: s.stateCode !== settings.stateCode },
      ]),
    ),
  };
}

const lineGst = (unitCost: number, quantity: number, gstRate: number, interState: boolean) =>
  calculateGst(Math.round(unitCost * quantity), gstRate as GstRate, interState);

function snapshot(item: ForecastItemDto, quantity: number): PlanItem {
  return {
    product: toObjectId(item.product.id),
    name: item.product.name,
    sku: item.product.sku,
    unit: item.product.unit,
    supplier: toObjectId(item.supplier!.id),
    stock: item.stock,
    onOrder: item.onOrder,
    dailyDemand: item.dailyDemand,
    daysUntilStockout: item.daysUntilStockout,
    packSize: item.packSize,
    suggestedQuantity: item.suggestedQuantity,
    quantity,
    unitCost: item.unitCost,
    gstRate: item.gstRate,
    reasons: item.reasons,
  } as PlanItem;
}

type Candidate = Awaited<ReturnType<typeof itemsToReorder>>[number];

/**
 * Fits the orders into a budget, most urgent items first at each step: first one pack of
 * everything, then enough of each to last until its delivery arrives, then what is left tops
 * items up towards the full suggestion. So a small budget covers many items a little, rather
 * than one item fully.
 */
function fitBudget(
  candidates: Candidate[],
  budget: number,
  cost: (c: Candidate, quantity: number) => number,
): Map<Candidate, number> {
  const chosen = new Map<Candidate, number>();
  let left = budget;
  const essential = (c: Candidate) => {
    const needed = c.leadTimeDemand + c.safetyStock - c.stock - c.onOrder;
    return Math.ceil(needed / c.packSize - 1e-9) * c.packSize;
  };
  const targets = [(c: Candidate) => c.packSize, essential, (c: Candidate) => c.suggestedQuantity];
  for (const target of targets) {
    for (const c of candidates) {
      const have = chosen.get(c) ?? 0;
      const wanted = Math.min(c.suggestedQuantity, Math.max(c.packSize, target(c)));
      let packs = Math.round((wanted - have) / c.packSize);
      while (packs > 0 && cost(c, have + packs * c.packSize) - cost(c, have) > left) packs--;
      if (packs <= 0) continue;
      left -= cost(c, have + packs * c.packSize) - cost(c, have);
      chosen.set(c, have + packs * c.packSize);
    }
  }
  return chosen;
}

/**
 * Prepares a draft from what needs reordering now, optionally within a budget (see fitBudget).
 * Any older draft is replaced, so there is only ever one plan waiting for review.
 */
export async function createRestockPlan(
  input: RestockPlanCreateInput,
  userId: string,
  source: RestockPlanSource = input.source,
): Promise<RestockPlanDto> {
  const supplierId = input.supplier ? toObjectId(input.supplier, 'Supplier not found') : undefined;
  if (supplierId && !(await SupplierModel.exists({ _id: supplierId }))) {
    throw fieldError(['supplier'], 'Supplier not found');
  }
  const candidates = await itemsToReorder(supplierId);
  const { suppliers } = await supplierStates(
    candidates.flatMap((c) => (c.supplier ? [toObjectId(c.supplier.id)] : [])),
  );

  const skipped: { product: Types.ObjectId; name: string; reason: string }[] = [];
  const skip = (c: Candidate, reason: string) =>
    skipped.push({ product: toObjectId(c.product.id), name: c.product.name, reason });
  const orderable = candidates.filter((c) => {
    if (!c.supplier) skip(c, 'No preferred supplier is set');
    else if (!c.supplierActive) skip(c, `${c.supplier.name} is inactive`);
    else return true;
    return false;
  });
  const cost = (c: Candidate, quantity: number) =>
    lineGst(c.unitCost, quantity, c.gstRate, suppliers.get(c.supplier!.id)?.interState ?? false)
      .total;
  const quantities =
    input.budget === undefined
      ? new Map(orderable.map((c) => [c, c.suggestedQuantity]))
      : fitBudget(orderable, input.budget, cost);
  const items: PlanItem[] = [];
  for (const c of orderable) {
    const quantity = quantities.get(c);
    if (quantity) items.push(snapshot(c, quantity));
    else skip(c, 'Over the budget');
  }

  if (items.length === 0) {
    throw AppError.conflict(
      candidates.length === 0
        ? 'Nothing needs reordering right now'
        : input.budget !== undefined && orderable.length > 0
          ? 'The budget is too small for even one pack of the most urgent item'
          : 'None of the items to reorder can go into a plan: ' +
            skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(', '),
    );
  }

  const id = await mongoose.connection.transaction(async (session) => {
    const now = new Date();
    const seq = await nextSequence(`restockPlan:${financialYear(now)}`, session);
    const planNumber = formatDocumentNumber(PLAN_PREFIX, now, seq);
    await RestockPlanModel.updateMany(
      { status: 'draft' },
      { $set: { status: 'expired', expiredReason: `Replaced by ${planNumber}` } },
      { session },
    );
    const [plan] = await RestockPlanModel.create(
      [
        {
          planNumber,
          status: 'draft',
          source,
          ...(input.budget !== undefined && { budget: input.budget }),
          ...(supplierId && { supplier: supplierId }),
          items,
          skipped,
          expiresAt: new Date(now.getTime() + TTL_MS),
          createdBy: userId,
        },
      ],
      { session },
    );
    return plan!._id;
  });
  return getRestockPlan(String(id));
}

async function findDraft(id: string) {
  await expireStale();
  const plan = await RestockPlanModel.findById(toObjectId(id, 'Restock plan not found'));
  if (!plan) throw AppError.notFound('Restock plan not found');
  if (plan.status === 'expired') {
    throw AppError.conflict(
      `This plan has expired (${plan.expiredReason?.toLowerCase() ?? 'out of date'}). Prepare a new one.`,
    );
  }
  if (plan.status !== 'draft') throw AppError.conflict(`This plan is already ${plan.status}`);
  return plan;
}

/** Sets the plan's lines: changed quantities, removed lines, and products added by hand. */
export async function updateRestockPlan(
  id: string,
  input: RestockPlanUpdateInput,
): Promise<RestockPlanDto> {
  const plan = await findDraft(id);
  const existing = new Map(plan.items.map((i) => [String(i.product), i]));
  const added = input.items.filter((i) => !existing.has(i.product));
  const forecasts = added.length
    ? await forecastItemsFor(added.map((i) => toObjectId(i.product, 'Product not found')))
    : new Map<string, ForecastItemDto>();

  const items = input.items.map((line, index) => {
    const path = ['items', index, 'product'];
    const current = existing.get(line.product);
    const unit = current?.unit ?? forecasts.get(line.product)?.product.unit;
    if (!current) {
      const forecast = forecasts.get(line.product);
      if (!forecast) throw fieldError(path, 'Product not found or inactive');
      if (!forecast.supplier) {
        throw fieldError(path, `${forecast.product.name} has no preferred supplier`);
      }
    }
    if (unit && !allowsFractions(unit) && !Number.isInteger(line.quantity)) {
      throw fieldError(['items', index, 'quantity'], `Order whole ${unit}`);
    }
    if (current) {
      current.quantity = line.quantity;
      return current;
    }
    return snapshot(forecasts.get(line.product)!, line.quantity);
  });
  plan.set('items', items);
  await plan.save();
  return getRestockPlan(id);
}

/**
 * Places one purchase order per supplier and marks the plan confirmed, all in one transaction.
 * If orders were placed for any of the products since the plan was made, the plan is stale:
 * it expires instead, so nothing is ordered twice.
 */
export async function confirmRestockPlan(id: string, userId: string): Promise<RestockPlanDto> {
  const draft = await findDraft(id);
  if (draft.items.length === 0) throw AppError.conflict('The plan has no items');
  const onOrderNow = await onOrderFor(draft.items.map((i) => i.product));
  const changed = draft.items.filter(
    (i) => (onOrderNow.get(String(i.product)) ?? 0) > i.onOrder + 1e-9,
  );
  if (changed.length > 0) {
    const names = changed.map((i) => i.name).join(', ');
    draft.status = 'expired';
    draft.expiredReason = `New orders were placed for ${names} after the plan was made`;
    await draft.save();
    throw AppError.conflict(
      `Orders were placed for ${names} after this plan was made. Prepare a new plan.`,
    );
  }

  await mongoose.connection.transaction(async (session) => {
    const now = new Date();
    // Claiming the draft first means a double click cannot place the orders twice.
    const plan = await RestockPlanModel.findOneAndUpdate(
      { _id: draft._id, status: 'draft', expiresAt: { $gt: now } },
      { $set: { status: 'confirmed', confirmedAt: now, confirmedBy: userId } },
      { session, returnDocument: 'after' },
    );
    if (!plan) throw AppError.conflict('This plan is no longer a draft');

    const bySupplier = new Map<string, PlanItem[]>();
    for (const item of plan.items) {
      const key = String(item.supplier);
      bySupplier.set(key, [...(bySupplier.get(key) ?? []), item]);
    }
    const orders: Types.ObjectId[] = [];
    // One at a time: a transaction's session cannot run operations in parallel.
    for (const [supplier, lines] of bySupplier) {
      const po = await insertPurchaseOrder(
        {
          supplier,
          items: lines.map((l) => ({
            product: String(l.product),
            quantity: l.quantity,
            unitCost: l.unitCost,
          })),
          place: true,
          notes: `From restock plan ${plan.planNumber}`,
        },
        userId,
        session,
      );
      orders.push(po.id);
    }
    plan.purchaseOrders = orders;
    await plan.save({ session });
  });
  return getRestockPlan(id);
}

export async function cancelRestockPlan(id: string): Promise<RestockPlanDto> {
  const plan = await findDraft(id);
  plan.status = 'cancelled';
  plan.cancelledAt = new Date();
  await plan.save();
  return getRestockPlan(id);
}

// --- Reading -------------------------------------------------------------------------------

function groupsOf(
  plan: PlanDoc,
  suppliers: Awaited<ReturnType<typeof supplierStates>>['suppliers'],
  orders: Map<string, { id: string; poNumber: string }>,
): RestockPlanGroupDto[] {
  const groups = new Map<string, RestockPlanGroupDto>();
  for (const item of plan.items) {
    const key = String(item.supplier);
    const supplier = suppliers.get(key);
    const interState = supplier?.interState ?? false;
    let group = groups.get(key);
    if (!group) {
      group = {
        supplier: {
          id: key,
          name: supplier?.name ?? 'Unknown',
          leadTimeDays: supplier?.leadTimeDays ?? 0,
        },
        interState,
        items: [],
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 0,
        ...(orders.has(key) && { purchaseOrder: orders.get(key)! }),
      };
      groups.set(key, group);
    }
    const gst = lineGst(item.unitCost, item.quantity, item.gstRate, interState);
    group.items.push({
      product: { id: String(item.product), name: item.name, sku: item.sku, unit: item.unit },
      stock: item.stock,
      onOrder: item.onOrder,
      dailyDemand: item.dailyDemand,
      daysUntilStockout: item.daysUntilStockout ?? null,
      packSize: item.packSize,
      suggestedQuantity: item.suggestedQuantity,
      quantity: item.quantity,
      unitCost: item.unitCost,
      gstRate: item.gstRate as GstRate,
      reasons: item.reasons,
      taxable: gst.taxable,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      total: gst.total,
    });
    for (const k of ['taxable', 'cgst', 'sgst', 'igst', 'total'] as const) group[k] += gst[k];
  }
  return [...groups.values()];
}

function summaryOf(
  plan: PlanDoc,
  groups: RestockPlanGroupDto[],
  userName: Map<string, string>,
): RestockPlanSummaryDto {
  const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'total') =>
    groups.reduce((a, g) => a + g[k], 0);
  return {
    id: String(plan._id),
    planNumber: plan.planNumber,
    status: plan.status,
    source: plan.source,
    itemCount: plan.items.length,
    supplierCount: groups.length,
    ...(plan.budget != null && { budget: plan.budget }),
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    total: sum('total'),
    createdAt: iso(plan.createdAt),
    expiresAt: iso(plan.expiresAt),
    ...(plan.createdBy && {
      createdBy: {
        id: String(plan.createdBy),
        name: userName.get(String(plan.createdBy)) ?? 'Unknown',
      },
    }),
  };
}

async function namesOf(ids: (Types.ObjectId | null | undefined)[]) {
  const users = await UserModel.find({ _id: { $in: ids.filter(Boolean) } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

export async function getRestockPlan(id: string): Promise<RestockPlanDto> {
  await expireStale();
  const plan = await RestockPlanModel.findById(
    toObjectId(id, 'Restock plan not found'),
  ).lean<PlanDoc>();
  if (!plan) throw AppError.notFound('Restock plan not found');
  const [{ suppliers }, orders, userName] = await Promise.all([
    supplierStates(
      [...new Set(plan.items.map((i) => String(i.supplier)))].map((s) => toObjectId(s)),
    ),
    PurchaseOrderModel.find(
      { _id: { $in: plan.purchaseOrders } },
      { poNumber: 1, supplier: 1 },
    ).lean(),
    namesOf([plan.createdBy, plan.confirmedBy]),
  ]);
  const ordersBySupplier = new Map(
    orders.map((o) => [String(o.supplier), { id: String(o._id), poNumber: o.poNumber }]),
  );
  const groups = groupsOf(plan, suppliers, ordersBySupplier);
  return {
    ...summaryOf(plan, groups, userName),
    groups,
    skipped: plan.skipped.map((s) => ({
      product: { id: String(s.product), name: s.name },
      reason: s.reason,
    })),
    ...(plan.confirmedAt && { confirmedAt: iso(plan.confirmedAt) }),
    ...(plan.confirmedBy && {
      confirmedBy: {
        id: String(plan.confirmedBy),
        name: userName.get(String(plan.confirmedBy)) ?? 'Unknown',
      },
    }),
    ...(plan.cancelledAt && { cancelledAt: iso(plan.cancelledAt) }),
    ...(plan.expiredReason && { expiredReason: plan.expiredReason }),
  };
}

export async function listRestockPlans(
  query: RestockPlanListQuery,
): Promise<Paginated<RestockPlanSummaryDto>> {
  await expireStale();
  const filter = query.status ? { status: query.status } : {};
  const [plans, total] = await Promise.all([
    RestockPlanModel.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<PlanDoc[]>(),
    RestockPlanModel.countDocuments(filter),
  ]);
  const supplierIds = [...new Set(plans.flatMap((p) => p.items.map((i) => String(i.supplier))))];
  const [{ suppliers }, userName] = await Promise.all([
    supplierStates(supplierIds.map((s) => toObjectId(s))),
    namesOf(plans.map((p) => p.createdBy)),
  ]);
  return {
    data: plans.map((p) => summaryOf(p, groupsOf(p, suppliers, new Map()), userName)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** For the dashboard banner: how many products need reordering, and any draft waiting. */
export async function getRestockAlerts(): Promise<RestockAlertDto> {
  await expireStale();
  const [items, openPlan] = await Promise.all([
    itemsToReorder(),
    RestockPlanModel.findOne({ status: 'draft' }, { planNumber: 1, items: 1 })
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const runningOut = items.filter(
    (i) => i.daysUntilStockout !== null && i.daysUntilStockout < (i.supplier?.leadTimeDays ?? 7),
  );
  return {
    reorder: items.length,
    runningOut: runningOut.length,
    outOfStock: items.filter((i) => i.stock <= 0).length,
    items: items.slice(0, 5).map((i) => ({
      id: i.product.id,
      name: i.product.name,
      daysUntilStockout: i.daysUntilStockout,
    })),
    ...(openPlan && {
      openPlan: {
        id: String(openPlan._id),
        planNumber: openPlan.planNumber,
        itemCount: openPlan.items.length,
      },
    }),
  };
}
