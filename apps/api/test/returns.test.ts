import { financialYear, gstinCheckCharacter } from '@ims/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  AuditLogModel,
  CategoryModel,
  CustomerModel,
  ProductModel,
  SaleModel,
  SaleReturnModel,
  SettingsModel,
  StockMovementModel,
} from '../src/models/index.js';
import { signedIn } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

let app: ReturnType<typeof createApp>;
let cashier: string;

beforeEach(async () => {
  app = createApp();
  cashier = (await signedIn(app, 'cashier')).bearer;
});

const gstin = (body: string) => body + gstinCheckCharacter(body);
const fy = financialYear(new Date());
const id = (doc: { _id: unknown }) => String(doc._id);

const till = () => ({
  post: (url: string, body: object) =>
    request(app).post(url).set('Authorization', cashier).send(body),
  get: (url: string) => request(app).get(url).set('Authorization', cashier),
});

async function setup() {
  await SettingsModel.create({
    shopName: 'Demo Mart',
    gstin: gstin('29AABCS1234K1Z'),
    stateCode: '29',
  });
  const category = await CategoryModel.create({ name: 'Staples' });
  const base = { category: category._id, taxInclusive: true, reorderLevel: 2 } as const;
  const soap = await ProductModel.create({
    ...base,
    sku: 'PRC-001',
    name: 'Bath Soap',
    hsnCode: '3401',
    unit: 'pack',
    gstRate: 18,
    costPrice: 12000,
    sellingPrice: 5000,
    stock: 10,
  });
  const sugar = await ProductModel.create({
    ...base,
    sku: 'STP-004',
    name: 'Sugar (loose)',
    hsnCode: '1701',
    unit: 'kg',
    gstRate: 5,
    costPrice: 4200,
    sellingPrice: 4810,
    stock: 5,
  });
  const trader = await CustomerModel.create({
    name: 'Western Traders',
    phone: '9822012345',
    gstin: gstin('27AAPFU0939F1Z'),
    stateCode: '27',
  });
  return { soap, sugar, trader };
}

/** 3 soaps at ₹50 and 1.5 kg sugar at ₹48.10/kg = ₹222.15, paid ₹222. */
async function bill(products: Awaited<ReturnType<typeof setup>>, customer?: string) {
  const res = await till().post('/api/sales', {
    items: [
      { product: id(products.soap), quantity: 3 },
      { product: id(products.sugar), quantity: 1.5 },
    ],
    ...(customer && { customer }),
    payments: [{ method: 'upi', amount: 22200 }],
  });
  expect(res.status).toBe(201);
  return res.body.sale as { id: string; grandTotal: number; invoiceNumber: string };
}

const stockOf = async (doc: { _id: unknown }) => (await ProductModel.findById(doc._id))!.stock;

describe('customer returns', () => {
  it('refunds part of a bill, puts the goods back and issues a numbered credit note', async () => {
    const products = await setup();
    const sale = await bill(products);
    expect(await stockOf(products.soap)).toBe(7);

    const res = await till().post('/api/returns', {
      sale: sale.id,
      items: [{ product: id(products.soap), quantity: 1 }],
      refundMethod: 'cash',
      reason: 'Wrong fragrance',
    });
    expect(res.status).toBe(201);
    const r = res.body.saleReturn;
    expect(r).toMatchObject({
      returnNumber: `RET/${fy}/00001`,
      sale: { id: sale.id, invoiceNumber: sale.invoiceNumber },
      refundMethod: 'cash',
      interState: false,
      placeOfSupply: '29',
      reason: 'Wrong fragrance',
      processedBy: { name: expect.any(String) },
    });
    // One soap is a third of ₹150: taxable ₹42.37 + CGST/SGST ₹3.81 = ₹49.99, rounded to ₹50.
    expect(r.items[0]).toMatchObject({
      quantity: 1,
      taxable: 4237,
      cgst: 381,
      sgst: 381,
      total: 4999,
      restock: true,
      hsnCode: '3401',
    });
    expect(r).toMatchObject({ totalRefund: 5000, roundOff: 1, totalTax: 762 });
    expect(await stockOf(products.soap)).toBe(8);

    const movement = await StockMovementModel.findOne({ type: 'sale_return' }).lean();
    expect(movement).toMatchObject({ quantity: 1, balanceAfter: 8, refModel: 'SaleReturn' });
    expect(await AuditLogModel.exists({ action: 'return.create' })).toBeTruthy();

    const after = (await till().get(`/api/sales/${sale.id}`)).body.sale;
    expect(after.status).toBe('partially_returned');
    expect(after.refundedTotal).toBe(5000);
    expect(after.items[0]).toMatchObject({ returnedQuantity: 1, refunded: { taxable: 4237 } });
    expect(after.returns).toEqual([
      expect.objectContaining({ returnNumber: r.returnNumber, totalRefund: 5000 }),
    ]);
  });

  it('refunds exactly what was paid once everything has come back', async () => {
    const products = await setup();
    const sale = await bill(products);
    const ret = (items: object[]) =>
      till().post('/api/returns', { sale: sale.id, items, refundMethod: 'upi', reason: 'Spoilt' });

    expect(
      (await ret([{ product: id(products.sugar), quantity: 0.5, restock: false }])).status,
    ).toBe(201);
    expect((await ret([{ product: id(products.soap), quantity: 2 }])).status).toBe(201);
    const last = await ret([
      { product: id(products.soap), quantity: 1 },
      { product: id(products.sugar), quantity: 1 },
    ]);
    expect(last.status).toBe(201);
    expect(last.body.saleReturn.returnNumber).toBe(`RET/${fy}/00003`);

    const refunds = await SaleReturnModel.find({ sale: sale.id }).lean();
    expect(refunds.reduce((sum, r) => sum + r.totalRefund, 0)).toBe(sale.grandTotal);
    const after = await SaleModel.findById(sale.id).lean();
    expect(after).toMatchObject({ status: 'returned', refundedTotal: 22200 });
    for (const item of after!.items) {
      const refunded = item.refunded!;
      expect(refunded.taxable + refunded.cgst + refunded.sgst + refunded.igst).toBe(item.total);
    }
    // Spoilt sugar stayed out of stock; the rest went back.
    expect(await stockOf(products.soap)).toBe(10);
    expect(await stockOf(products.sugar)).toBe(4.5);

    const again = await ret([{ product: id(products.soap), quantity: 1 }]);
    expect(again.status).toBe(400);
    expect(again.body.error.message).toBe('Bath Soap was already returned');
  });

  it('refuses more than was sold, fractions of packs and products not on the invoice', async () => {
    const products = await setup();
    const sale = await bill(products);
    const other = await ProductModel.create({
      ...products.soap.toObject(),
      _id: undefined,
      sku: 'PRC-009',
      barcode: undefined,
      name: 'Hand Wash',
    });
    const errorFor = async (item: object) => {
      const res = await till().post('/api/returns', {
        sale: sale.id,
        items: [item],
        refundMethod: 'cash',
        reason: 'Testing limits',
      });
      expect(res.status).toBe(400);
      return res.body.error;
    };
    expect((await errorFor({ product: id(products.soap), quantity: 4 })).message).toBe(
      'Only 3 pack of Bath Soap can still be returned',
    );
    expect((await errorFor({ product: id(products.soap), quantity: 1.5 })).message).toBe(
      'Bath Soap is returned in whole pack',
    );
    const missing = await errorFor({ product: id(other), quantity: 1 });
    expect(missing.details[0].path).toEqual(['items', 0, 'product']);
    expect(await SaleReturnModel.countDocuments()).toBe(0);
    expect(await stockOf(products.soap)).toBe(7);
  });

  it('takes back the last items only once when two tills try at the same moment', async () => {
    const products = await setup();
    const sale = await bill(products);
    const attempt = () =>
      till().post('/api/returns', {
        sale: sale.id,
        items: [{ product: id(products.soap), quantity: 3 }],
        refundMethod: 'cash',
        reason: 'Duplicate purchase',
      });
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
    expect(await stockOf(products.soap)).toBe(10);
    const after = await SaleModel.findById(sale.id).lean();
    expect(after!.items[0]!.returnedQuantity).toBe(3);
  });

  it('answers a resent return with the credit note already issued', async () => {
    const products = await setup();
    const sale = await bill(products);
    const body = {
      sale: sale.id,
      items: [{ product: id(products.soap), quantity: 1 }],
      refundMethod: 'cash',
      reason: 'Changed mind',
      clientRef: 'return-0001-abcd',
    };
    const first = await till().post('/api/returns', body);
    const second = await till().post('/api/returns', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.saleReturn.id).toBe(first.body.saleReturn.id);
    expect(await stockOf(products.soap)).toBe(8);
  });

  it('reverses IGST for a customer in another state and lists, filters and prints credit notes', async () => {
    const products = await setup();
    const sale = await bill(products, id(products.trader));
    const res = await till().post('/api/returns', {
      sale: sale.id,
      items: [{ product: id(products.soap), quantity: 3 }],
      refundMethod: 'upi',
      refundReference: '412345678901',
      reason: 'Ordered by mistake',
    });
    expect(res.status).toBe(201);
    const r = res.body.saleReturn;
    expect(r).toMatchObject({
      interState: true,
      placeOfSupply: '27',
      customer: { name: 'Western Traders', gstin: products.trader.gstin },
      refundReference: '412345678901',
    });
    expect(r.items[0]).toMatchObject({ cgst: 0, sgst: 0, igst: 2288, total: 15000 });

    const list = await till().get('/api/returns?search=western');
    expect(list.status).toBe(200);
    expect(list.body.summary).toEqual({ count: 1, total: 15000 });
    expect(list.body.data[0]).toMatchObject({ returnNumber: r.returnNumber, itemCount: 1 });
    const bySale = await till().get(`/api/returns?sale=${sale.id}`);
    expect(bySale.body.total).toBe(1);
    expect((await till().get('/api/returns?search=nobody')).body.total).toBe(0);

    const pdf = await till()
      .get(`/api/returns/${r.id}/credit-note.pdf`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain(`RET-${fy}-00001.pdf`);
    const body = (pdf.body as Buffer).toString('latin1');
    expect(body.startsWith('%PDF-')).toBe(true);
    expect(body).toContain('Credit note RET');
  });

  it('needs the returns permission and a real sale', async () => {
    const products = await setup();
    const sale = await bill(products);
    const body = {
      sale: sale.id,
      items: [{ product: id(products.soap), quantity: 1 }],
      refundMethod: 'cash',
      reason: 'Wrong item',
    };
    expect((await request(app).post('/api/returns').send(body)).status).toBe(401);
    const missing = await till().post('/api/returns', {
      ...body,
      sale: '507f1f77bcf86cd799439011',
    });
    expect(missing.status).toBe(404);
    expect((await till().get('/api/returns/507f1f77bcf86cd799439011')).status).toBe(404);
  });
});
