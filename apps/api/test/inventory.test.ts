import mongoose from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  AuditLogModel,
  CategoryModel,
  ProductModel,
  PurchaseOrderModel,
  SaleModel,
  StockMovementModel,
} from '../src/models/index.js';
import { recordMovement } from '../src/modules/inventory/ledger.js';
import { signedIn } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

let app: ReturnType<typeof createApp>;
let manager: { bearer: string; user: { _id: mongoose.Types.ObjectId } };
let cashier: string;

beforeEach(async () => {
  app = createApp();
  manager = await signedIn(app, 'manager');
  cashier = (await signedIn(app, 'cashier')).bearer;
});

async function makeProducts() {
  const category = await CategoryModel.create({ name: 'Staples' });
  const base = {
    category: category._id,
    hsnCode: '1006',
    gstRate: 5,
    taxInclusive: true,
    reorderLevel: 5,
  } as const;
  const rice = await ProductModel.create({
    ...base,
    sku: 'STP-001',
    name: 'Rice',
    unit: 'pcs',
    costPrice: 50000,
    sellingPrice: 61700,
    stock: 10,
  });
  const sugar = await ProductModel.create({
    ...base,
    sku: 'STP-004',
    name: 'Sugar',
    unit: 'kg',
    costPrice: 4200,
    sellingPrice: 4800,
    stock: 2.5,
  });
  return { category, rice, sugar };
}

const adjust = (body: object, auth = manager.bearer) =>
  request(app).post('/api/inventory/adjustments').set('Authorization', auth).send(body);

describe('recordMovement (the stock ledger)', () => {
  it('changes stock and writes the ledger entry together', async () => {
    const { sugar } = await makeProducts();
    const result = await mongoose.connection.transaction((session) =>
      recordMovement(
        { product: sugar._id, type: 'sale', quantity: -0.3, userId: String(manager.user._id) },
        session,
      ),
    );
    expect(result).toMatchObject({ before: 2.5, after: 2.2 }); // exact, not 2.1999…
    const movement = await StockMovementModel.findById(result.movementId).lean();
    expect(movement).toMatchObject({ quantity: -0.3, balanceAfter: 2.2, unitCost: 4200 });
    expect((await ProductModel.findById(sugar._id))?.stock).toBe(2.2);
  });

  it('refuses to take stock below zero and leaves nothing behind', async () => {
    const { rice } = await makeProducts();
    await expect(
      mongoose.connection.transaction((session) =>
        recordMovement(
          { product: rice._id, type: 'sale', quantity: -11, userId: String(manager.user._id) },
          session,
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'INSUFFICIENT_STOCK' });
    expect((await ProductModel.findById(rice._id))?.stock).toBe(10);
    expect(await StockMovementModel.countDocuments()).toBe(0);
  });

  it('never oversells when many requests race for the last units', async () => {
    const { rice } = await makeProducts(); // 10 in stock
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        mongoose.connection.transaction((session) =>
          recordMovement(
            { product: rice._id, type: 'sale', quantity: -3, userId: String(manager.user._id) },
            session,
          ),
        ),
      ),
    );
    const succeeded = attempts.filter((a) => a.status === 'fulfilled').length;
    expect(succeeded).toBe(3); // 3 × 3 = 9 ≤ 10; a fourth would need 12
    const stock = (await ProductModel.findById(rice._id))!.stock;
    expect(stock).toBe(1);
    const ledger = await StockMovementModel.aggregate([
      { $group: { _id: null, sum: { $sum: '$quantity' } } },
    ]);
    expect(10 + ledger[0].sum).toBe(stock);
  });

  it('does not touch the product "last changed" time', async () => {
    const { rice } = await makeProducts();
    const before = (await ProductModel.findById(rice._id))!.updatedAt;
    await mongoose.connection.transaction((session) =>
      recordMovement(
        { product: rice._id, type: 'purchase', quantity: 5, userId: String(manager.user._id) },
        session,
      ),
    );
    expect((await ProductModel.findById(rice._id))!.updatedAt).toEqual(before);
  });
});

describe('POST /api/inventory/adjustments', () => {
  it('applies a stock count, recording only the difference', async () => {
    const { rice, sugar } = await makeProducts();
    const res = await adjust({
      reason: 'count',
      note: 'Monthly count',
      items: [
        { product: String(rice._id), mode: 'set', quantity: 8 },
        { product: String(sugar._id), mode: 'set', quantity: 2.5 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.adjusted).toEqual([
      { product: { id: String(rice._id), name: 'Rice' }, before: 10, after: 8, change: -2 },
    ]);
    expect(res.body.unchanged).toEqual([{ id: String(sugar._id), name: 'Sugar' }]);

    const movements = await StockMovementModel.find().lean();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: 'adjustment',
      reason: 'count',
      note: 'Monthly count',
      quantity: -2,
    });
    expect(await AuditLogModel.countDocuments({ action: 'inventory.adjust' })).toBe(1);
  });

  it('writes off damaged stock', async () => {
    const { rice } = await makeProducts();
    const res = await adjust({
      reason: 'damaged',
      items: [{ product: String(rice._id), mode: 'change', quantity: -2 }],
    });
    expect(res.body.adjusted[0]).toMatchObject({ before: 10, after: 8 });
  });

  it('is all-or-nothing across lines', async () => {
    const { rice, sugar } = await makeProducts();
    const res = await adjust({
      reason: 'lost',
      items: [
        { product: String(sugar._id), mode: 'change', quantity: -1 },
        { product: String(rice._id), mode: 'change', quantity: -50 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toEqual(['items', 1, 'quantity']);
    expect((await ProductModel.findById(sugar._id))?.stock).toBe(2.5); // first line rolled back
    expect(await StockMovementModel.countDocuments()).toBe(0);
  });

  it('enforces whole numbers for counted units and sensible reasons', async () => {
    const { rice } = await makeProducts();
    const fraction = await adjust({
      reason: 'count',
      items: [{ product: String(rice._id), mode: 'set', quantity: 7.5 }],
    });
    expect(fraction.status).toBe(400);
    expect(fraction.body.error.message).toMatch(/whole pcs/);

    const damagedUp = await adjust({
      reason: 'damaged',
      items: [{ product: String(rice._id), mode: 'set', quantity: 12 }],
    });
    expect(damagedUp.status).toBe(400);
    expect(damagedUp.body.error.message).toMatch(/Stock count correction/);

    const other = await adjust({
      reason: 'other',
      items: [{ product: String(rice._id), mode: 'change', quantity: 1 }],
    });
    expect(other.status).toBe(400);
  });

  it('is not available to cashiers', async () => {
    const { rice } = await makeProducts();
    const res = await adjust(
      { reason: 'count', items: [{ product: String(rice._id), mode: 'set', quantity: 1 }] },
      cashier,
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /api/inventory/movements', () => {
  async function history() {
    const { rice, sugar } = await makeProducts();
    const userId = manager.user._id;
    const sale = await SaleModel.create({
      invoiceNumber: 'INV/26-27/00007',
      placeOfSupply: '29',
      interState: false,
      items: [
        {
          product: rice._id,
          name: 'Rice',
          sku: 'STP-001',
          hsnCode: '1006',
          unit: 'pcs',
          quantity: 1,
          unitPrice: 61700,
          taxInclusive: true,
          gstRate: 5,
          taxable: 58762,
          cgst: 1469,
          sgst: 1469,
          igst: 0,
          total: 61700,
          unitCost: 50000,
        },
      ],
      gross: 61700,
      discount: 0,
      taxable: 58762,
      cgst: 1469,
      sgst: 1469,
      igst: 0,
      totalTax: 2938,
      roundOff: 0,
      grandTotal: 61700,
      payments: [{ method: 'cash', amount: 61700 }],
      cashier: userId,
    });
    const po = await PurchaseOrderModel.create({
      poNumber: 'PO/26-27/00003',
      supplier: new mongoose.Types.ObjectId(),
      interState: false,
      items: [
        {
          product: rice._id,
          name: 'Rice',
          quantity: 5,
          unitCost: 50000,
          gstRate: 5,
          taxable: 1,
          cgst: 0,
          sgst: 0,
          igst: 0,
          total: 1,
        },
      ],
      taxable: 1,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: 1,
    });
    const at = (iso: string) => new Date(iso);
    await StockMovementModel.create([
      {
        product: rice._id,
        type: 'opening',
        quantity: 6,
        balanceAfter: 6,
        unitCost: 50000,
        createdBy: userId,
        occurredAt: at('2026-10-01T04:00:00Z'),
      },
      {
        product: rice._id,
        type: 'purchase',
        quantity: 5,
        balanceAfter: 11,
        unitCost: 50000,
        refModel: 'PurchaseOrder',
        refId: po._id,
        createdBy: userId,
        occurredAt: at('2026-10-05T04:00:00Z'),
      },
      {
        product: rice._id,
        type: 'sale',
        quantity: -1,
        balanceAfter: 10,
        unitCost: 50000,
        refModel: 'Sale',
        refId: sale._id,
        createdBy: userId,
        occurredAt: at('2026-10-10T19:00:00Z'),
      }, // 11 Oct IST
      {
        product: sugar._id,
        type: 'adjustment',
        quantity: -0.5,
        balanceAfter: 2.5,
        unitCost: 4200,
        reason: 'damaged',
        createdBy: userId,
        occurredAt: at('2026-10-12T04:00:00Z'),
      },
    ]);
    return { rice, sugar };
  }

  const list = (query: string, auth = manager.bearer) =>
    request(app).get(`/api/inventory/movements?${query}`).set('Authorization', auth);

  it('lists newest first with product, user, document numbers and values', async () => {
    await history();
    const res = await list('');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.data.map((m: { type: string }) => m.type)).toEqual([
      'adjustment',
      'sale',
      'purchase',
      'opening',
    ]);
    expect(res.body.data[1]).toMatchObject({
      product: { name: 'Rice', sku: 'STP-001', unit: 'pcs' },
      quantity: -1,
      balanceAfter: 10,
      value: -50000,
      reference: { kind: 'Sale', number: 'INV/26-27/00007' },
      createdBy: { name: expect.stringMatching(/Test manager/) },
    });
    expect(res.body.data[2].reference).toMatchObject({
      kind: 'PurchaseOrder',
      number: 'PO/26-27/00003',
    });
    expect(res.body.data[0]).toMatchObject({ reason: 'damaged', value: -2100 });
  });

  it('filters by product, type and IST date range', async () => {
    const { sugar } = await history();
    expect((await list(`product=${sugar._id}`)).body.total).toBe(1);
    expect((await list('type=purchase')).body.data[0].quantity).toBe(5);
    // The sale at 19:00 UTC on 10 Oct is 00:30 on 11 Oct in India.
    expect(
      (await list('from=2026-10-11&to=2026-10-11')).body.data.map((m: { type: string }) => m.type),
    ).toEqual(['sale']);
    expect((await list('from=2026-10-12&to=2026-10-01')).status).toBe(400);
  });

  it('hides costs from cashiers', async () => {
    await history();
    const res = await list('', cashier);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('value');
    expect(res.body.data[0]).not.toHaveProperty('unitCost');
  });
});

describe('GET /api/inventory/summary', () => {
  it('values stock at cost and selling price, with recent write-offs', async () => {
    const { category, rice } = await makeProducts();
    await ProductModel.create({
      category: category._id,
      hsnCode: '1006',
      gstRate: 5,
      unit: 'pcs',
      sku: 'STP-009',
      name: 'Empty',
      costPrice: 100,
      sellingPrice: 200,
      stock: 0,
      reorderLevel: 5,
    });
    await StockMovementModel.create({
      product: rice._id,
      type: 'adjustment',
      quantity: -2,
      balanceAfter: 8,
      unitCost: 50000,
      reason: 'expired',
      occurredAt: new Date(),
    });

    const res = await request(app)
      .get('/api/inventory/summary')
      .set('Authorization', manager.bearer);
    expect(res.status).toBe(200);
    // Rice 10 × ₹500 + Sugar 2.5 × ₹42 = ₹5,105 at cost.
    expect(res.body).toMatchObject({
      costValue: 510500,
      retailValue: 629000,
      products: 3,
      lowStock: 1,
      outOfStock: 1,
    });
    expect(res.body.byCategory[0]).toMatchObject({ category: { name: 'Staples' }, products: 3 });
    expect(res.body.writeOffs30d).toEqual({
      value: 100000,
      byReason: [{ reason: 'expired', value: 100000 }],
    });
  });

  it('is limited to roles that see reports', async () => {
    expect(
      (await request(app).get('/api/inventory/summary').set('Authorization', cashier)).status,
    ).toBe(403);
  });
});

describe('cost prices', () => {
  it('are hidden from cashiers in product responses', async () => {
    const { rice } = await makeProducts();
    const asCashier = await request(app)
      .get(`/api/products/${rice._id}`)
      .set('Authorization', cashier);
    expect(asCashier.body.product).not.toHaveProperty('costPrice');
    const list = await request(app).get('/api/products').set('Authorization', cashier);
    expect(list.body.data.every((p: object) => !('costPrice' in p))).toBe(true);
    const asManager = await request(app)
      .get(`/api/products/${rice._id}`)
      .set('Authorization', manager.bearer);
    expect(asManager.body.product.costPrice).toBe(50000);
  });
});
