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
  SettingsModel,
  StockMovementModel,
} from '../src/models/index.js';
import { signedIn } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

let app: ReturnType<typeof createApp>;
let cashier: string;
let manager: string;

beforeEach(async () => {
  app = createApp();
  cashier = (await signedIn(app, 'cashier')).bearer;
  manager = (await signedIn(app, 'manager')).bearer;
});

const gstin = (body: string) => body + gstinCheckCharacter(body);
const fy = financialYear(new Date());

async function setup() {
  await SettingsModel.create({
    shopName: 'Demo Mart',
    legalName: 'Demo Mart Private Limited',
    gstin: gstin('29AABCS1234K1Z'),
    stateCode: '29',
    address: { line1: '12, 4th Cross', city: 'Bengaluru', pincode: '560038' },
    invoiceFooter: 'Thank you!',
  });
  const category = await CategoryModel.create({ name: 'Staples' });
  const base = { category: category._id, taxInclusive: true, reorderLevel: 2 } as const;
  const rice = await ProductModel.create({
    ...base,
    sku: 'STP-001',
    name: 'Basmati Rice 5 kg',
    hsnCode: '1006',
    unit: 'pcs',
    gstRate: 5,
    costPrice: 50000,
    sellingPrice: 61700,
    stock: 10,
  });
  const soap = await ProductModel.create({
    ...base,
    sku: 'PRC-001',
    name: 'Bath Soap',
    hsnCode: '3401',
    unit: 'pack',
    gstRate: 18,
    costPrice: 12000,
    sellingPrice: 18000,
    stock: 5,
  });
  const sugar = await ProductModel.create({
    ...base,
    sku: 'STP-004',
    name: 'Sugar (loose)',
    hsnCode: '1701',
    unit: 'kg',
    gstRate: 5,
    costPrice: 4200,
    sellingPrice: 4800,
    stock: 2,
  });
  const pens = await ProductModel.create({
    ...base,
    sku: 'STN-002',
    name: 'Ball Pens',
    hsnCode: '9608',
    unit: 'pack',
    gstRate: 18,
    costPrice: 7000,
    sellingPrice: 10000,
    taxInclusive: false,
    stock: 20,
  });
  const walkInBusiness = await CustomerModel.create({
    name: 'Western Traders',
    phone: '9822012345',
    gstin: gstin('27AAPFU0939F1Z'),
    stateCode: '27',
  });
  return { rice, soap, sugar, pens, walkInBusiness };
}

const as = (auth: string) => ({
  post: (url: string, body: object) => request(app).post(url).set('Authorization', auth).send(body),
  get: (url: string) => request(app).get(url).set('Authorization', auth),
});
const till = () => as(cashier);
const id = (doc: { _id: unknown }) => String(doc._id);
const cash = (amount: number) => [{ method: 'cash', amount }];

describe('billing a customer', () => {
  it('bills a walk-in customer with CGST + SGST, rounds to the rupee and takes the goods out of stock', async () => {
    const { rice, soap } = await setup();
    const res = await till().post('/api/sales', {
      items: [
        { product: id(rice), quantity: 1, discount: 50 },
        { product: id(soap), quantity: 1 },
      ],
      payments: cash(79700),
    });
    expect(res.status).toBe(201);
    const sale = res.body.sale;
    expect(sale.invoiceNumber).toBe(`INV/${fy}/00001`);
    expect(sale).toMatchObject({ interState: false, placeOfSupply: '29', status: 'completed' });
    expect(sale.customer).toBeUndefined();
    // Rice: ₹617 − ₹0.50 = ₹616.50 incl. 5% → taxable ₹587.14, tax ₹29.36 split equally.
    expect(sale.items[0]).toMatchObject({
      gross: 61700,
      discount: 50,
      taxable: 58714,
      cgst: 1468,
      sgst: 1468,
      igst: 0,
      total: 61650,
      hsnCode: '1006',
    });
    // Soap: ₹180 incl. 18% → taxable ₹152.54, tax ₹27.46.
    expect(sale.items[1]).toMatchObject({ taxable: 15254, cgst: 1373, sgst: 1373, total: 18000 });
    // ₹796.50 is rounded up to ₹797.
    expect(sale).toMatchObject({
      gross: 79700,
      discount: 50,
      taxable: 73968,
      cgst: 2841,
      sgst: 2841,
      igst: 0,
      totalTax: 5682,
      roundOff: 50,
      grandTotal: 79700,
    });
    expect(sale.items[0]).not.toHaveProperty('unitCost');

    expect((await ProductModel.findById(rice._id).lean())?.stock).toBe(9);
    expect((await ProductModel.findById(soap._id).lean())?.stock).toBe(4);
    const movements = await StockMovementModel.find({ type: 'sale' }).sort({ quantity: 1 }).lean();
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => [m.quantity, m.balanceAfter, m.unitCost])).toEqual(
      expect.arrayContaining([
        [-1, 9, 50000],
        [-1, 4, 12000],
      ]),
    );
    expect(movements.every((m) => m.refModel === 'Sale' && String(m.refId) === sale.id)).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: 'sale.create' })).toBe(1);
  });

  it('adds GST on top for tax-exclusive prices', async () => {
    const { pens } = await setup();
    const res = await till().post('/api/sales', {
      items: [{ product: id(pens), quantity: 3, discount: 1000 }],
      payments: cash(34200),
    });
    expect(res.status).toBe(201);
    // ₹300 − ₹10 = ₹290 taxable + 18% = ₹342.20, rounded to ₹342.
    expect(res.body.sale).toMatchObject({ taxable: 29000, cgst: 2610, sgst: 2610 });
    expect(res.body.sale).toMatchObject({ roundOff: -20, grandTotal: 34200 });
  });

  it('charges IGST for a customer registered in another state', async () => {
    const { rice, walkInBusiness } = await setup();
    const res = await till().post('/api/sales', {
      customer: id(walkInBusiness),
      items: [{ product: id(rice), quantity: 1 }],
      payments: [{ method: 'card', amount: 61700, reference: 'AUTH42' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.sale).toMatchObject({
      interState: true,
      placeOfSupply: '27',
      customer: { name: 'Western Traders', gstin: walkInBusiness.gstin, stateCode: '27' },
      taxable: 58762,
      cgst: 0,
      sgst: 0,
      igst: 2938,
      payments: [{ method: 'card', amount: 61700, reference: 'AUTH42' }],
    });
  });

  it('accepts a payment split across methods that covers the bill exactly', async () => {
    const { rice } = await setup();
    const items = [{ product: id(rice), quantity: 2 }];
    const short = await till().post('/api/sales', { items, payments: cash(100000) });
    expect(short.status).toBe(400);
    expect(short.body.error.details[0]).toMatchObject({
      path: ['payments'],
      message: 'Payments add up to ₹1,000.00 but the bill is ₹1,234.00',
    });

    const split = await till().post('/api/sales', {
      items,
      payments: [
        { method: 'cash', amount: 50000 },
        { method: 'upi', amount: 73400, reference: 'UPI123456' },
      ],
    });
    expect(split.status).toBe(201);
    expect(split.body.sale.payments).toHaveLength(2);
    // The failed attempt did not use up an invoice number.
    expect(split.body.sale.invoiceNumber).toBe(`INV/${fy}/00001`);
  });

  it('refuses to sell more than is in stock and leaves nothing behind', async () => {
    const { rice, soap } = await setup();
    const res = await till().post('/api/sales', {
      items: [
        { product: id(soap), quantity: 1 },
        { product: id(rice), quantity: 11 },
      ],
      payments: cash(696700),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details[0]).toMatchObject({
      path: ['items', 1, 'quantity'],
      message: 'Only 10 pcs of Basmati Rice 5 kg in stock',
    });
    expect(await SaleModel.countDocuments()).toBe(0);
    expect(await StockMovementModel.countDocuments()).toBe(0);
    expect((await ProductModel.findById(soap._id).lean())?.stock).toBe(5);
  });

  it('sells loose goods by weight but whole units only for pieces', async () => {
    const { rice, sugar } = await setup();
    const loose = await till().post('/api/sales', {
      items: [{ product: id(sugar), quantity: 0.75 }],
      payments: cash(3600),
    });
    expect(loose.status).toBe(201);
    expect((await ProductModel.findById(sugar._id).lean())?.stock).toBe(1.25);

    const half = await till().post('/api/sales', {
      items: [{ product: id(rice), quantity: 1.5 }],
      payments: cash(92600),
    });
    expect(half.status).toBe(400);
    expect(half.body.error.details[0].message).toBe('Basmati Rice 5 kg is sold in whole pcs');
  });

  it('rejects inactive products, unknown customers and discounts larger than the line', async () => {
    const { rice, soap } = await setup();
    await ProductModel.updateOne({ _id: soap._id }, { isActive: false });
    const inactive = await till().post('/api/sales', {
      items: [{ product: id(soap), quantity: 1 }],
      payments: cash(18000),
    });
    expect(inactive.body.error.details[0].message).toBe('Bath Soap is no longer sold');

    const customer = await till().post('/api/sales', {
      customer: '507f1f77bcf86cd799439011',
      items: [{ product: id(rice), quantity: 1 }],
      payments: cash(61700),
    });
    expect(customer.status).toBe(400);
    expect(customer.body.error.details[0]).toMatchObject({ path: ['customer'] });

    const discount = await till().post('/api/sales', {
      items: [{ product: id(rice), quantity: 1, discount: 61800 }],
      payments: cash(100),
    });
    expect(discount.status).toBe(400);
    expect(discount.body.error.details[0]).toMatchObject({
      path: ['items', 0, 'discount'],
      message: 'Discount cannot be more than ₹617.00',
    });
  });

  it('never sells the last units twice when two tills bill at once', async () => {
    const { soap } = await setup();
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () =>
        till().post('/api/sales', {
          items: [{ product: id(soap), quantity: 2 }],
          payments: cash(36000),
        }),
      ),
    );
    const ok = attempts.filter((r) => r.status === 201);
    expect(ok).toHaveLength(2);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await ProductModel.findById(soap._id).lean())?.stock).toBe(1);
    // Invoice numbers stay unique and without gaps.
    expect(ok.map((r) => r.body.sale.invoiceNumber).sort()).toEqual([
      `INV/${fy}/00001`,
      `INV/${fy}/00002`,
    ]);
  });

  it('does not bill twice when the till sends the same bill again', async () => {
    const { rice } = await setup();
    const bill = {
      items: [{ product: id(rice), quantity: 1 }],
      payments: cash(61700),
      clientRef: 'f3c1b2a4-0d5e-4f6a-8b7c-9d0e1f2a3b4c',
    };
    const [first, second] = await Promise.all([
      till().post('/api/sales', bill),
      till().post('/api/sales', bill),
    ]);
    const third = await till().post('/api/sales', bill);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(third.status).toBe(200);
    expect(new Set([first, second, third].map((r) => r.body.sale.id)).size).toBe(1);
    expect(await SaleModel.countDocuments()).toBe(1);
    expect((await ProductModel.findById(rice._id).lean())?.stock).toBe(9);
    expect(await AuditLogModel.countDocuments({ action: 'sale.create' })).toBe(1);
  });

  it('requires sign-in', async () => {
    await setup();
    expect((await request(app).post('/api/sales').send({})).status).toBe(401);
    expect((await request(app).get('/api/sales')).status).toBe(401);
  });
});

describe('sales history', () => {
  async function history() {
    const { rice, soap, walkInBusiness } = await setup();
    const a = await till().post('/api/sales', {
      items: [{ product: id(rice), quantity: 1 }],
      payments: cash(61700),
    });
    const b = await till().post('/api/sales', {
      customer: id(walkInBusiness),
      items: [{ product: id(soap), quantity: 2 }],
      payments: [{ method: 'upi', amount: 36000 }],
    });
    // An older sale from 3 days ago.
    const old = new Date(Date.now() - 3 * 86_400_000);
    await SaleModel.updateOne({ _id: a.body.sale.id }, { soldAt: old });
    return { a: a.body.sale, b: b.body.sale, old };
  }

  it('lists newest first with a summary of everything that matches', async () => {
    const { a, b } = await history();
    const res = await as(manager).get('/api/sales');
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual([b.id, a.id]);
    expect(res.body.summary).toEqual({ count: 2, total: 97700 });
    expect(res.body.data[0]).toMatchObject({
      invoiceNumber: b.invoiceNumber,
      customer: { name: 'Western Traders' },
      itemCount: 1,
      grandTotal: 36000,
      paymentMethods: ['upi'],
      status: 'completed',
    });
    expect(res.body.data[0].cashier.name).toMatch(/^Test cashier/);
  });

  it('filters by IST date, payment method and invoice number or customer', async () => {
    const { a, b, old } = await history();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(old);
    const ids = async (query: string) =>
      (await till().get(`/api/sales?${query}`)).body.data.map((s: { id: string }) => s.id);
    expect(await ids(`from=${day}&to=${day}`)).toEqual([a.id]);
    expect(await ids('method=upi')).toEqual([b.id]);
    expect(await ids('search=western')).toEqual([b.id]);
    expect(await ids(`search=${encodeURIComponent(a.invoiceNumber)}`)).toEqual([a.id]);
    expect((await till().get('/api/sales?from=2026-10-10&to=2026-10-01')).status).toBe(400);
  });

  it('shows one sale in full and answers 404 for unknown ids', async () => {
    const { b } = await history();
    const res = await till().get(`/api/sales/${b.id}`);
    expect(res.body.sale).toMatchObject({ id: b.id, interState: true, igst: b.igst });
    expect((await till().get('/api/sales/507f1f77bcf86cd799439011')).status).toBe(404);
    expect((await till().get('/api/sales/nope')).status).toBe(404);
  });

  it('prints a GST invoice as a PDF', async () => {
    const { b } = await history();
    const res = await till()
      .get(`/api/sales/${b.id}/invoice.pdf`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(
      `${b.invoiceNumber.replaceAll('/', '-')}.pdf`,
    );
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain(`Tax invoice ${b.invoiceNumber}`);
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    expect((await till().get('/api/sales/507f1f77bcf86cd799439011/invoice.pdf')).status).toBe(404);
  });
});

describe('customer lookup for the till', () => {
  it('finds active customers by name, phone or GSTIN', async () => {
    const { walkInBusiness } = await setup();
    await CustomerModel.create({ name: 'Former Customer', phone: '9822099999', isActive: false });
    const res = await till().get('/api/customers?search=98220');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        id: id(walkInBusiness),
        name: 'Western Traders',
        phone: '9822012345',
        gstin: walkInBusiness.gstin,
        stateCode: '27',
      },
    ]);
    expect((await till().get('/api/customers?search=27AAPFU')).body.total).toBe(1);
  });
});
