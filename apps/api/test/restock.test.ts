import {
  addDays,
  gstinCheckCharacter,
  istDateKey,
  istDayRange,
  type ForecastOverviewDto,
} from '@ims/shared';
import type { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  AuditLogModel,
  CategoryModel,
  ProductModel,
  PurchaseOrderModel,
  RestockPlanModel,
  SaleModel,
  SettingsModel,
  StockMovementModel,
  SupplierModel,
} from '../src/models/index.js';
import { signedIn } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

let app: ReturnType<typeof createApp>;
let manager: string;
let cashier: string;

beforeEach(async () => {
  app = createApp();
  manager = (await signedIn(app, 'manager')).bearer;
  cashier = (await signedIn(app, 'cashier')).bearer;
});

const call = (auth: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', auth),
  post: (url: string, body: object = {}) =>
    request(app).post(url).set('Authorization', auth).send(body),
  patch: (url: string, body: object) =>
    request(app).patch(url).set('Authorization', auth).send(body),
});
const m = () => call(manager);
const gstin = (body: string) => body + gstinCheckCharacter(body);
const today = istDateKey(new Date());
const HISTORY = 84;

/**
 * Twelve weeks of history for six products. Sales and closing stock are written straight to
 * the collections: the forecasts only read what was sold each day and the stock left at night.
 */
async function setup() {
  await SettingsModel.create({
    shopName: 'Demo Mart',
    gstin: gstin('29AABCS1234K1Z'),
    stateCode: '29',
  });
  const category = await CategoryModel.create({ name: 'Grocery' });
  const local = await SupplierModel.create({
    name: 'Greenfield Dairy',
    stateCode: '29',
    leadTimeDays: 2,
  });
  const pune = await SupplierModel.create({
    name: 'Western Snacks',
    stateCode: '27',
    gstin: gstin('27AAACW1234F1Z'),
    leadTimeDays: 3,
  });
  const product = (sku: string, name: string, extra: Record<string, unknown>) =>
    ProductModel.create({
      sku,
      name,
      category: category._id,
      hsnCode: '0401',
      unit: 'pcs',
      gstRate: 5,
      costPrice: 4000,
      sellingPrice: 5600,
      taxInclusive: true,
      reorderLevel: 0,
      ...extra,
    });
  const milk = await product('DRY-001', 'Toned Milk 1 L', {
    stock: 10,
    packSize: 12,
    preferredSupplier: local._id,
  });
  const soap = await product('PRC-001', 'Bath Soap', { stock: 400, preferredSupplier: local._id });
  const oil = await product('STP-006', 'Sunflower Oil 1 L', {
    stock: 0,
    packSize: 6,
    preferredSupplier: local._id,
  });
  const cards = await product('STN-003', 'Greeting Cards', {
    stock: 5,
    preferredSupplier: local._id,
  });
  const loose = await product('STP-099', 'Loose Jaggery', { stock: 0 });
  const chips = await product('SNK-002', 'Potato Chips', { stock: 4, preferredSupplier: pune._id });

  const daily: [Types.ObjectId, (day: number) => number, (day: number) => number][] = [
    // [product, units sold `day` days ago, closing stock that night]
    [milk._id, () => 20, () => 30],
    [soap._id, () => 5, () => 400],
    // Sold 10 a day, then the shelf was empty for the last 10 days.
    [oil._id, (d) => (d <= 10 ? 0 : 10), (d) => (d <= 10 ? 0 : 50)],
    // Stopped selling 70 days ago.
    [cards._id, (d) => (d > 70 ? 1 : 0), () => 5],
    [loose._id, () => 5, (d) => (d <= 3 ? 0 : 20)],
    [chips._id, () => 8, () => 20],
  ];
  const sales = [];
  const movements = [];
  for (let d = 1; d <= HISTORY; d++) {
    const { start } = istDayRange(addDays(today, -d));
    const soldAt = new Date(start.getTime() + 10 * 3_600_000);
    const items = daily
      .filter(([, sold]) => sold(d) > 0)
      .map(([product, sold]) => ({ product, quantity: sold(d) }));
    if (items.length > 0) {
      sales.push({
        invoiceNumber: `INV/T/${String(d).padStart(5, '0')}`,
        soldAt,
        status: 'completed',
        items,
      });
    }
    for (const [product, , closing] of daily) {
      movements.push({
        product,
        type: 'sale',
        quantity: -1,
        balanceAfter: closing(d),
        occurredAt: new Date(start.getTime() + 20 * 3_600_000),
      });
    }
  }
  await SaleModel.collection.insertMany(sales);
  await StockMovementModel.collection.insertMany(movements);
  return { local, pune, milk, soap, oil, cards, loose, chips };
}

const itemOf = (overview: ForecastOverviewDto, name: string) =>
  overview.items.find((i) => i.product.name === name)!;

describe('forecasts', () => {
  it('says what to reorder, what is fine and what is dead stock', async () => {
    await setup();
    const res = await m().get('/api/forecast');
    expect(res.status).toBe(200);
    const { overview } = res.body;
    expect(overview.asOf).toBe(addDays(today, -1));

    const milk = itemOf(overview, 'Toned Milk 1 L');
    expect(milk).toMatchObject({
      status: 'reorder',
      method: 'holt-winters',
      stock: 10,
      packSize: 12,
      supplier: { name: 'Greenfield Dairy', leadTimeDays: 2 },
      daysUntilStockout: 0,
    });
    expect(milk.dailyDemand).toBeCloseTo(20, 0);
    // Two days' delivery + a week, plus safety stock, less the 10 on the shelf, in packs of 12.
    expect(milk.suggestedQuantity % 12).toBe(0);
    expect(milk.suggestedQuantity).toBeGreaterThanOrEqual(180 - 10);
    expect(milk.suggestedQuantity).toBeLessThanOrEqual(192);
    expect(milk.reasons).toEqual([
      'Sells about 20 a day',
      '10 left: runs out today',
      'Supplier takes 2 days',
    ]);

    expect(itemOf(overview, 'Bath Soap').status).toBe('ok');
    expect(itemOf(overview, 'Greeting Cards')).toMatchObject({
      status: 'dead',
      suggestedQuantity: 0,
      reasons: ['No sale in 70 days, so it is not reordered'],
    });
    // Ten days with an empty shelf are not read as "nobody wants it".
    const oil = itemOf(overview, 'Sunflower Oil 1 L');
    expect(oil.status).toBe('reorder');
    expect(oil.dailyDemand).toBeGreaterThan(8);
    expect(oil.reasons).toContain('Out of stock now');

    expect(overview.counts).toMatchObject({ reorder: 4, ok: 1, dead: 1 });
    // Most urgent first.
    expect(overview.items[0].status).toBe('reorder');
    expect(overview.items.at(-1).status).toBe('dead');
  });

  it('shows one product’s history, forecast, model and accuracy', async () => {
    const { milk } = await setup();
    const res = await m().get(`/api/forecast/products/${milk._id}`);
    expect(res.status).toBe(200);
    const { forecast } = res.body;
    expect(forecast.history).toHaveLength(56);
    expect(forecast.history.at(-1)).toEqual({
      date: addDays(today, -1),
      quantity: 20,
      stockedOut: false,
    });
    expect(forecast.forecast).toHaveLength(28);
    expect(forecast.forecast[0].date).toBe(today);
    expect(forecast.forecast[0].expected).toBeCloseTo(20, 0);
    expect(forecast.model).toMatchObject({ method: 'holt-winters', historyDays: HISTORY });
    expect(forecast.model.season).toHaveLength(7);
    expect(forecast.backtest.mape).toBeLessThan(5);

    expect((await m().get('/api/forecast/products/64b000000000000000000000')).status).toBe(404);
  });

  it('reports accuracy against a moving average', async () => {
    await setup();
    const res = await m().get('/api/forecast/accuracy');
    expect(res.status).toBe(200);
    expect(res.body.accuracy).toMatchObject({
      products: expect.any(Number),
      weeks: expect.any(Number),
      baseline: { mape: expect.any(Number), wape: expect.any(Number) },
    });
    expect(res.body.accuracy.wape).toBeLessThan(10);
  });

  it('is for managers and admins only', async () => {
    await setup();
    expect((await call(cashier).get('/api/forecast')).status).toBe(403);
    expect((await call(cashier).get('/api/restock/alerts')).status).toBe(403);
    expect((await call(cashier).post('/api/restock/plans')).status).toBe(403);
  });
});

describe('restock plans', () => {
  it('groups what to reorder by supplier, with GST, and lists what it could not include', async () => {
    const { milk, chips } = await setup();
    const res = await m().post('/api/restock/plans');
    expect(res.status).toBe(201);
    const { plan } = res.body;
    expect(plan).toMatchObject({
      planNumber: expect.stringMatching(/^RST\/\d{2}-\d{2}\/00001$/),
      status: 'draft',
      source: 'manual',
      itemCount: 3,
      supplierCount: 2,
    });
    expect(Date.parse(plan.expiresAt) - Date.parse(plan.createdAt)).toBeCloseTo(24 * 3_600_000, -3);

    const dairy = plan.groups.find(
      (g: { supplier: { name: string } }) => g.supplier.name === 'Greenfield Dairy',
    );
    expect(dairy.interState).toBe(false);
    expect(dairy.items.map((i: { product: { name: string } }) => i.product.name).sort()).toEqual([
      'Sunflower Oil 1 L',
      'Toned Milk 1 L',
    ]);
    const milkLine = dairy.items.find(
      (i: { product: { id: string } }) => i.product.id === String(milk._id),
    );
    expect(milkLine.quantity).toBe(milkLine.suggestedQuantity);
    // ₹40 a litre + 5%: half as CGST, half as SGST.
    expect(milkLine.taxable).toBe(milkLine.quantity * 4000);
    expect(milkLine.cgst).toBe(milkLine.sgst);
    expect(milkLine.total).toBe(milkLine.taxable + milkLine.cgst + milkLine.sgst);

    const western = plan.groups.find(
      (g: { supplier: { name: string } }) => g.supplier.name === 'Western Snacks',
    );
    expect(western.interState).toBe(true);
    expect(western.items[0].product.id).toBe(String(chips._id));
    expect(western.igst).toBeGreaterThan(0);
    expect(western.cgst).toBe(0);
    expect(plan.total).toBe(dairy.total + western.total);

    expect(plan.skipped).toEqual([
      {
        product: { id: expect.any(String), name: 'Loose Jaggery' },
        reason: 'No preferred supplier is set',
      },
    ]);
    expect(await AuditLogModel.countDocuments({ action: 'restock_plan.create' })).toBe(1);

    const alerts = (await m().get('/api/restock/alerts')).body.alerts;
    expect(alerts).toMatchObject({
      reorder: 4,
      outOfStock: 2,
      openPlan: { id: plan.id, planNumber: plan.planNumber, itemCount: 3 },
    });
    expect(alerts.items[0].daysUntilStockout).toBe(0);
  });

  it('keeps one draft at a time and can be limited to one supplier', async () => {
    const { pune } = await setup();
    const first = (await m().post('/api/restock/plans')).body.plan;
    const second = (
      await m().post('/api/restock/plans', { supplier: String(pune._id), source: 'alert' })
    ).body.plan;
    expect(second).toMatchObject({ source: 'alert', itemCount: 1, supplierCount: 1 });
    const old = (await m().get(`/api/restock/plans/${first.id}`)).body.plan;
    expect(old).toMatchObject({
      status: 'expired',
      expiredReason: `Replaced by ${second.planNumber}`,
    });

    const list = (await m().get('/api/restock/plans?status=draft')).body;
    expect(list.total).toBe(1);
    expect(list.data[0].id).toBe(second.id);
  });

  it('fits a budget, covering urgent items a little before any fully', async () => {
    await setup();
    const full = (await m().post('/api/restock/plans')).body.plan;
    const budget = Math.round(full.total / 3);
    const res = await m().post('/api/restock/plans', { budget });
    expect(res.status).toBe(201);
    const { plan } = res.body;
    expect(plan.budget).toBe(budget);
    expect(plan.total).toBeLessThanOrEqual(budget);
    expect(plan.itemCount).toBe(3);
    for (const line of plan.groups.flatMap((g: { items: unknown[] }) => g.items)) {
      expect(line.quantity % line.packSize).toBe(0);
      expect(line.quantity).toBeLessThanOrEqual(line.suggestedQuantity);
    }

    const tiny = await m().post('/api/restock/plans', { budget: 100 });
    expect(tiny.status).toBe(409);
    expect(tiny.body.error.message).toBe(
      'The budget is too small for even one pack of the most urgent item',
    );
  });

  it('can be edited: quantities changed, lines removed, products added by hand', async () => {
    const { milk, soap, loose } = await setup();
    const { plan } = (await m().post('/api/restock/plans')).body;
    const res = await m().patch(`/api/restock/plans/${plan.id}`, {
      items: [
        { product: String(milk._id), quantity: 100 },
        { product: String(soap._id), quantity: 24 },
      ],
    });
    expect(res.status).toBe(200);
    const edited = res.body.plan;
    expect(edited.itemCount).toBe(2);
    expect(edited.supplierCount).toBe(1);
    const lines = edited.groups[0].items;
    expect(lines[0]).toMatchObject({ product: { name: 'Toned Milk 1 L' }, quantity: 100 });
    expect(lines[1]).toMatchObject({
      product: { name: 'Bath Soap' },
      quantity: 24,
      suggestedQuantity: 0,
    });

    const noSupplier = await m().patch(`/api/restock/plans/${plan.id}`, {
      items: [{ product: String(loose._id), quantity: 5 }],
    });
    expect(noSupplier.status).toBe(400);
    expect(noSupplier.body.error.message).toBe('Loose Jaggery has no preferred supplier');
    const fraction = await m().patch(`/api/restock/plans/${plan.id}`, {
      items: [{ product: String(milk._id), quantity: 2.5 }],
    });
    expect(fraction.status).toBe(400);
    expect(fraction.body.error.details[0].path).toEqual(['items', 0, 'quantity']);
  });

  it('places one purchase order per supplier when a person confirms it', async () => {
    const { milk } = await setup();
    const { plan } = (await m().post('/api/restock/plans')).body;
    expect((await call(cashier).post(`/api/restock/plans/${plan.id}/confirm`)).status).toBe(403);

    const res = await m().post(`/api/restock/plans/${plan.id}/confirm`);
    expect(res.status).toBe(200);
    const confirmed = res.body.plan;
    expect(confirmed).toMatchObject({
      status: 'confirmed',
      confirmedBy: { name: expect.any(String) },
    });
    expect(confirmed.groups.every((g: { purchaseOrder?: unknown }) => g.purchaseOrder)).toBe(true);

    const orders = await PurchaseOrderModel.find().sort({ poNumber: 1 }).lean();
    expect(orders).toHaveLength(2);
    expect(
      orders.every(
        (o) => o.status === 'ordered' && o.notes === `From restock plan ${plan.planNumber}`,
      ),
    ).toBe(true);
    const dairy = orders.find((o) => o.items.length === 2)!;
    expect(dairy.total).toBe(
      confirmed.groups.find(
        (g: { supplier: { name: string } }) => g.supplier.name === 'Greenfield Dairy',
      ).total,
    );
    expect(await AuditLogModel.countDocuments({ action: 'restock_plan.confirm' })).toBe(1);

    // The goods now on order are counted, so milk no longer needs reordering.
    const overview = (await m().get('/api/forecast')).body.overview;
    expect(itemOf(overview, 'Toned Milk 1 L').onOrder).toBe(
      confirmed.groups
        .flatMap((g: { items: { product: { id: string }; quantity: number }[] }) => g.items)
        .find((i: { product: { id: string } }) => i.product.id === String(milk._id)).quantity,
    );
    expect(itemOf(overview, 'Toned Milk 1 L').status).not.toBe('reorder');

    const again = await m().post(`/api/restock/plans/${plan.id}/confirm`);
    expect(again.status).toBe(409);
    expect(await PurchaseOrderModel.countDocuments()).toBe(2);
  });

  it('expires instead of ordering twice when goods were ordered since it was made', async () => {
    const { local, milk } = await setup();
    const { plan } = (await m().post('/api/restock/plans')).body;
    await m().post('/api/purchase-orders', {
      supplier: String(local._id),
      items: [{ product: String(milk._id), quantity: 50, unitCost: 4000 }],
      place: true,
    });
    const res = await m().post(`/api/restock/plans/${plan.id}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(
      'Orders were placed for Toned Milk 1 L after this plan was made. Prepare a new plan.',
    );
    expect(await PurchaseOrderModel.countDocuments()).toBe(1);
    expect((await m().get(`/api/restock/plans/${plan.id}`)).body.plan.status).toBe('expired');
  });

  it('expires after a day and can be cancelled', async () => {
    await setup();
    const { plan } = (await m().post('/api/restock/plans')).body;
    await RestockPlanModel.updateOne({ _id: plan.id }, { expiresAt: new Date(Date.now() - 1000) });
    const stale = await m().post(`/api/restock/plans/${plan.id}/confirm`);
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(
      /^This plan has expired \(not confirmed within 24 hours\)/,
    );
    expect((await m().get('/api/restock/alerts')).body.alerts.openPlan).toBeUndefined();

    const next = (await m().post('/api/restock/plans')).body.plan;
    const cancelled = await m().post(`/api/restock/plans/${next.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.plan).toMatchObject({
      status: 'cancelled',
      cancelledAt: expect.any(String),
    });
    expect((await m().post(`/api/restock/plans/${next.id}/confirm`)).status).toBe(409);
  });

  it('says so when nothing needs reordering', async () => {
    await SettingsModel.create({
      shopName: 'Demo Mart',
      gstin: gstin('29AABCS1234K1Z'),
      stateCode: '29',
    });
    const res = await m().post('/api/restock/plans');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Nothing needs reordering right now');
  });
});
