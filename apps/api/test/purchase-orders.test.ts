import { gstinCheckCharacter } from '@ims/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  AuditLogModel,
  CategoryModel,
  ProductModel,
  PurchaseOrderModel,
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

const gstin = (body: string) => body + gstinCheckCharacter(body);

async function setup() {
  await SettingsModel.create({
    shopName: 'Demo Mart',
    gstin: gstin('29AABCS1234K1Z'),
    stateCode: '29',
  });
  const category = await CategoryModel.create({ name: 'Staples' });
  const local = await SupplierModel.create({
    name: 'Karnataka Agro',
    stateCode: '29',
    leadTimeDays: 3,
  });
  const pune = await SupplierModel.create({
    name: 'Western FMCG',
    stateCode: '27',
    leadTimeDays: 6,
  });
  const base = {
    category: category._id,
    hsnCode: '1006',
    taxInclusive: true,
    reorderLevel: 5,
  } as const;
  const rice = await ProductModel.create({
    ...base,
    sku: 'STP-001',
    name: 'Rice',
    unit: 'pcs',
    gstRate: 5,
    costPrice: 50000,
    sellingPrice: 61700,
    stock: 10,
  });
  const soap = await ProductModel.create({
    ...base,
    sku: 'PRC-001',
    name: 'Soap',
    unit: 'pack',
    gstRate: 18,
    costPrice: 12000,
    sellingPrice: 18000,
    stock: 0,
  });
  const sugar = await ProductModel.create({
    ...base,
    sku: 'STP-004',
    name: 'Sugar',
    unit: 'kg',
    gstRate: 5,
    costPrice: 4200,
    sellingPrice: 4800,
    stock: 2,
  });
  return { local, pune, rice, soap, sugar };
}

const call = (auth: string) => ({
  post: (url: string, body: object = {}) =>
    request(app).post(url).set('Authorization', auth).send(body),
  put: (url: string, body: object) => request(app).put(url).set('Authorization', auth).send(body),
  get: (url: string) => request(app).get(url).set('Authorization', auth),
});
const m = () => call(manager);

describe('creating purchase orders', () => {
  it('works out CGST + SGST for a supplier in the same state', async () => {
    const { local, rice, soap } = await setup();
    const res = await m().post('/api/purchase-orders', {
      supplier: String(local._id),
      items: [
        { product: String(rice._id), quantity: 10, unitCost: 50000 },
        { product: String(soap._id), quantity: 12, unitCost: 12000 },
      ],
      place: true,
    });
    expect(res.status).toBe(201);
    const po = res.body.purchaseOrder;
    expect(po.poNumber).toMatch(/^PO\/\d{2}-\d{2}\/00001$/);
    expect(po).toMatchObject({ status: 'ordered', interState: false, itemCount: 2 });
    // Rice: ₹5,000 + 5% = 125 + 125; Soap: ₹1,440 + 18% = 129.60 + 129.60.
    expect(po.items[0]).toMatchObject({
      taxable: 500000,
      cgst: 12500,
      sgst: 12500,
      igst: 0,
      total: 525000,
      gstRate: 5,
    });
    expect(po.items[1]).toMatchObject({ taxable: 144000, cgst: 12960, sgst: 12960, total: 169920 });
    expect(po).toMatchObject({ taxable: 644000, cgst: 25460, sgst: 25460, igst: 0, total: 694920 });
    expect(po.orderedAt).toBeDefined();
    // Expected = midnight IST, 3 days from now (the supplier's delivery time).
    const daysAhead = (new Date(po.expectedAt).getTime() - Date.now()) / 86_400_000;
    expect(daysAhead).toBeGreaterThan(2);
    expect(daysAhead).toBeLessThan(3);
    expect(new Date(po.expectedAt).toISOString()).toMatch(/T18:30:00\.000Z$/);
  });

  it('charges IGST for a supplier in another state', async () => {
    const { pune, soap } = await setup();
    const res = await m().post('/api/purchase-orders', {
      supplier: String(pune._id),
      items: [{ product: String(soap._id), quantity: 10, unitCost: 12000 }],
    });
    expect(res.body.purchaseOrder).toMatchObject({
      status: 'draft',
      interState: true,
      igst: 21600,
      cgst: 0,
      total: 141600,
    });
    expect(res.body.purchaseOrder.orderedAt).toBeUndefined();
  });

  it('numbers orders in sequence', async () => {
    const { local, rice } = await setup();
    const body = {
      supplier: String(local._id),
      items: [{ product: String(rice._id), quantity: 1, unitCost: 1 }],
    };
    await m().post('/api/purchase-orders', body);
    const second = await m().post('/api/purchase-orders', body);
    expect(second.body.purchaseOrder.poNumber).toMatch(/00002$/);
  });

  it('rejects inactive suppliers or products, fractions of whole units and unknown products', async () => {
    const { local, rice, sugar } = await setup();
    await SupplierModel.updateOne({ _id: local._id }, { isActive: false });
    const inactive = await m().post('/api/purchase-orders', {
      supplier: String(local._id),
      items: [{ product: String(rice._id), quantity: 1, unitCost: 1 }],
    });
    expect(inactive.body.error.details[0]).toMatchObject({ path: ['supplier'] });
    await SupplierModel.updateOne({ _id: local._id }, { isActive: true });

    const half = await m().post('/api/purchase-orders', {
      supplier: String(local._id),
      items: [
        { product: String(sugar._id), quantity: 2.5, unitCost: 4200 }, // fine: kg
        { product: String(rice._id), quantity: 1.5, unitCost: 50000 },
      ],
    });
    expect(half.body.error.details[0]).toMatchObject({ path: ['items', 1, 'quantity'] });

    const unknown = await m().post('/api/purchase-orders', {
      supplier: String(local._id),
      items: [{ product: '507f1f77bcf86cd799439011', quantity: 1, unitCost: 1 }],
    });
    expect(unknown.body.error.details[0]).toMatchObject({ path: ['items', 0, 'product'] });
    expect(await PurchaseOrderModel.countDocuments()).toBe(0);
  });

  it('is limited to roles that manage purchases', async () => {
    const { local, rice } = await setup();
    const body = {
      supplier: String(local._id),
      items: [{ product: String(rice._id), quantity: 1, unitCost: 1 }],
    };
    expect((await call(cashier).post('/api/purchase-orders', body)).status).toBe(403);
    expect((await call(cashier).get('/api/purchase-orders')).status).toBe(403);
  });
});

describe('drafts', () => {
  it('can be edited and then placed, but not edited after', async () => {
    const { local, pune, rice, soap } = await setup();
    const created = await m().post('/api/purchase-orders', {
      supplier: String(local._id),
      items: [{ product: String(rice._id), quantity: 5, unitCost: 50000 }],
    });
    const id = created.body.purchaseOrder.id;

    const edited = await m().put(`/api/purchase-orders/${id}`, {
      supplier: String(pune._id),
      items: [{ product: String(soap._id), quantity: 6, unitCost: 11500 }],
      expectedAt: '2026-12-01',
    });
    expect(edited.body.purchaseOrder).toMatchObject({
      supplier: { name: 'Western FMCG' },
      interState: true,
      itemCount: 1,
      status: 'draft',
    });

    const placed = await m().post(`/api/purchase-orders/${id}/place`);
    expect(placed.body.purchaseOrder).toMatchObject({
      status: 'ordered',
      expectedAt: '2026-11-30T18:30:00.000Z',
    });
    expect((await m().post(`/api/purchase-orders/${id}/place`)).status).toBe(409);
    const again = await m().put(`/api/purchase-orders/${id}`, {
      supplier: String(pune._id),
      items: [{ product: String(soap._id), quantity: 1, unitCost: 1 }],
    });
    expect(again.status).toBe(409);
  });
});

describe('receiving goods', () => {
  async function placed() {
    const ctx = await setup();
    const res = await m().post('/api/purchase-orders', {
      supplier: String(ctx.local._id),
      items: [
        { product: String(ctx.rice._id), quantity: 10, unitCost: 53000 },
        { product: String(ctx.sugar._id), quantity: 25, unitCost: 4000 },
      ],
      place: true,
    });
    return { ...ctx, id: res.body.purchaseOrder.id as string };
  }

  it('adds stock, records the ledger and updates cost to a weighted average', async () => {
    const { id, rice, sugar } = await placed();
    const res = await m().post(`/api/purchase-orders/${id}/receive`, {
      items: [{ product: String(rice._id), quantity: 6 }],
      supplierInvoiceNumber: 'SI-1001',
    });
    expect(res.status).toBe(200);
    const po = res.body.purchaseOrder;
    expect(po.status).toBe('partially_received');
    expect(po.items[0]).toMatchObject({ receivedQuantity: 6, remainingQuantity: 4 });
    expect(po.receipts[0]).toMatchObject({
      supplierInvoiceNumber: 'SI-1001',
      items: [{ product: { name: 'Rice' }, quantity: 6 }],
    });

    const product = await ProductModel.findById(rice._id).lean();
    expect(product?.stock).toBe(16);
    // (10 × ₹500 + 6 × ₹530) / 16 = ₹511.25
    expect(product?.costPrice).toBe(51125);
    const movement = await StockMovementModel.findOne({ type: 'purchase' }).lean();
    expect(movement).toMatchObject({
      quantity: 6,
      balanceAfter: 16,
      unitCost: 53000,
      refModel: 'PurchaseOrder',
    });

    // Second delivery completes the order.
    const done = await m().post(`/api/purchase-orders/${id}/receive`, {
      items: [
        { product: String(rice._id), quantity: 4 },
        { product: String(sugar._id), quantity: 25 },
      ],
    });
    expect(done.body.purchaseOrder.status).toBe('received');
    expect(done.body.purchaseOrder.receivedAt).toBeDefined();
    expect(done.body.purchaseOrder.receipts).toHaveLength(2);
    expect((await ProductModel.findById(sugar._id).lean())?.stock).toBe(27);
    expect(await AuditLogModel.countDocuments({ action: 'purchase_order.receive' })).toBe(2);
  });

  it('shows open quantities as "on order" on the product', async () => {
    const { id, rice } = await placed();
    await m().post(`/api/purchase-orders/${id}/receive`, {
      items: [{ product: String(rice._id), quantity: 6 }],
    });
    expect((await m().get(`/api/products/${rice._id}`)).body.product.onOrder).toBe(4);
  });

  it('refuses more than is still to arrive, and leaves nothing half-done', async () => {
    const { id, rice, sugar } = await placed();
    const res = await m().post(`/api/purchase-orders/${id}/receive`, {
      items: [
        { product: String(sugar._id), quantity: 5 },
        { product: String(rice._id), quantity: 11 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ path: ['items', 1, 'quantity'] });
    expect((await ProductModel.findById(sugar._id).lean())?.stock).toBe(2); // first line rolled back
    expect(await StockMovementModel.countDocuments()).toBe(0);
  });

  it('never receives the same goods twice when two people record the delivery at once', async () => {
    const { id, rice } = await placed();
    const body = { items: [{ product: String(rice._id), quantity: 10 }] };
    const results = await Promise.all([
      m().post(`/api/purchase-orders/${id}/receive`, body),
      m().post(`/api/purchase-orders/${id}/receive`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await ProductModel.findById(rice._id).lean())?.stock).toBe(20);
    expect(await StockMovementModel.countDocuments({ type: 'purchase' })).toBe(1);
  });

  it('cannot receive against drafts or cancelled orders, or products not on the order', async () => {
    const { local, rice, soap } = await setup();
    const draft = await m().post('/api/purchase-orders', {
      supplier: String(local._id),
      items: [{ product: String(rice._id), quantity: 1, unitCost: 1 }],
    });
    const id = draft.body.purchaseOrder.id;
    expect(
      (
        await m().post(`/api/purchase-orders/${id}/receive`, {
          items: [{ product: String(rice._id), quantity: 1 }],
        })
      ).body.error.message,
    ).toMatch(/Place the order/);
    await m().post(`/api/purchase-orders/${id}/place`);
    const stranger = await m().post(`/api/purchase-orders/${id}/receive`, {
      items: [{ product: String(soap._id), quantity: 1 }],
    });
    expect(stranger.body.error.details[0].message).toMatch(/not on the order/);
    await m().post(`/api/purchase-orders/${id}/cancel`, { reason: 'Supplier out of stock' });
    expect(
      (
        await m().post(`/api/purchase-orders/${id}/receive`, {
          items: [{ product: String(rice._id), quantity: 1 }],
        })
      ).status,
    ).toBe(409);
  });
});

describe('cancelling', () => {
  it('cancels untouched orders, closes partly received ones, and refuses finished ones', async () => {
    const { local, rice } = await setup();
    const make = async () =>
      (
        await m().post('/api/purchase-orders', {
          supplier: String(local._id),
          items: [{ product: String(rice._id), quantity: 4, unitCost: 50000 }],
          place: true,
        })
      ).body.purchaseOrder.id as string;

    const a = await make();
    const cancelled = await m().post(`/api/purchase-orders/${a}/cancel`, {
      reason: 'Ordered by mistake',
    });
    expect(cancelled.body.purchaseOrder).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Ordered by mistake',
    });

    const b = await make();
    await m().post(`/api/purchase-orders/${b}/receive`, {
      items: [{ product: String(rice._id), quantity: 1 }],
    });
    const closed = await m().post(`/api/purchase-orders/${b}/cancel`, {
      reason: 'Rest discontinued',
    });
    expect(closed.body.purchaseOrder.status).toBe('closed');
    expect((await m().get(`/api/products/${rice._id}`)).body.product.onOrder).toBe(0);

    const c = await make();
    await m().post(`/api/purchase-orders/${c}/receive`, {
      items: [{ product: String(rice._id), quantity: 4 }],
    });
    expect(
      (await m().post(`/api/purchase-orders/${c}/cancel`, { reason: 'Too late' })).status,
    ).toBe(409);
    expect((await m().post(`/api/purchase-orders/${a}/cancel`, { reason: 'x' })).status).toBe(400); // reason too short
  });
});

describe('listing', () => {
  it('filters by status, supplier and number, and flags overdue orders', async () => {
    const { local, pune, rice, soap } = await setup();
    const make = (supplier: string, product: string, place: boolean) =>
      m().post('/api/purchase-orders', {
        supplier,
        items: [{ product, quantity: 1, unitCost: 100 }],
        place,
      });
    await make(String(local._id), String(rice._id), true);
    await make(String(pune._id), String(soap._id), true);
    await make(String(local._id), String(rice._id), false);
    await PurchaseOrderModel.updateOne(
      { poNumber: /00001$/ },
      { expectedAt: new Date(Date.now() - 3 * 86_400_000) },
    );

    const all = await m().get('/api/purchase-orders');
    expect(all.body.total).toBe(3);
    expect(all.body.data[0].poNumber).toMatch(/00003$/); // newest first
    const open = await m().get('/api/purchase-orders?status=open');
    expect(
      open.body.data.map((o: { poNumber: string; overdue: boolean }) => [
        o.poNumber.slice(-1),
        o.overdue,
      ]),
    ).toEqual([
      ['2', false],
      ['1', true],
    ]);
    expect((await m().get(`/api/purchase-orders?supplier=${pune._id}`)).body.total).toBe(1);
    expect((await m().get('/api/purchase-orders?search=00003')).body.data[0].status).toBe('draft');
  });
});

describe('settings', () => {
  it('are readable by any signed-in user', async () => {
    await setup();
    const res = await call(cashier).get('/api/settings');
    expect(res.body.settings).toMatchObject({
      shopName: 'Demo Mart',
      stateCode: '29',
      purchaseOrderPrefix: 'PO',
    });
  });

  it('must exist before ordering', async () => {
    const { local, rice } = await setup();
    await SettingsModel.deleteMany({});
    const res = await m().post('/api/purchase-orders', {
      supplier: String(local._id),
      items: [{ product: String(rice._id), quantity: 1, unitCost: 1 }],
    });
    expect(res.body.error.code).toBe('SETTINGS_MISSING');
  });
});
