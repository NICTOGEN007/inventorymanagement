import { gstinCheckCharacter, istDateKey } from '@ims/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  CategoryModel,
  CustomerModel,
  ProductModel,
  SettingsModel,
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
const today = istDateKey(new Date());
const as = (auth: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', auth),
  post: (url: string, body: object) => request(app).post(url).set('Authorization', auth).send(body),
});
const m = () => as(manager);

/**
 * Today: rice ×2 to a walk-in (₹1,234 cash), soap ×1 to a Maharashtra trader (₹180 UPI, IGST),
 * one rice brought back; ten pens received from a local supplier and never sold.
 */
async function trade() {
  await SettingsModel.create({
    shopName: 'Demo Mart',
    gstin: gstin('29AABCS1234K1Z'),
    stateCode: '29',
  });
  const category = await CategoryModel.create({ name: 'Staples' });
  const other = await CategoryModel.create({ name: 'Stationery' });
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
    stock: 20,
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
    reorderLevel: 5,
  });
  // A name a spreadsheet would run as a formula.
  const pens = await ProductModel.create({
    ...base,
    category: other._id,
    sku: 'STN-002',
    name: '=Gel Pens',
    hsnCode: '9608',
    unit: 'pack',
    gstRate: 18,
    costPrice: 7000,
    sellingPrice: 10000,
    taxInclusive: false,
    stock: 10,
  });
  const trader = await CustomerModel.create({
    name: 'Western Traders',
    gstin: gstin('27AAPFU0939F1Z'),
    stateCode: '27',
  });
  const supplier = await SupplierModel.create({
    name: 'Karnataka Stationers',
    gstin: gstin('29AAACK1234L1Z'),
    stateCode: '29',
    leadTimeDays: 3,
  });

  const till = as(cashier);
  const walkIn = await till.post('/api/sales', {
    items: [{ product: String(rice._id), quantity: 2 }],
    payments: [{ method: 'cash', amount: 123400 }],
  });
  const business = await till.post('/api/sales', {
    items: [{ product: String(soap._id), quantity: 1 }],
    customer: String(trader._id),
    payments: [{ method: 'upi', amount: 18000 }],
  });
  const ret = await till.post('/api/returns', {
    sale: walkIn.body.sale.id,
    items: [{ product: String(rice._id), quantity: 1 }],
    refundMethod: 'cash',
    reason: 'Bought one too many',
  });
  const po = await m().post('/api/purchase-orders', {
    supplier: String(supplier._id),
    items: [{ product: String(pens._id), quantity: 10, unitCost: 7000 }],
    place: true,
  });
  await m().post(`/api/purchase-orders/${po.body.purchaseOrder.id}/receive`, {
    items: [{ product: String(pens._id), quantity: 10 }],
    supplierInvoiceNumber: 'KS-778',
  });
  expect([walkIn.status, business.status, ret.status, po.status]).toEqual([201, 201, 201, 201]);
  return {
    rice,
    soap,
    pens,
    other,
    walkIn: walkIn.body.sale,
    business: business.body.sale,
    saleReturn: ret.body.saleReturn,
  };
}

describe('dashboard', () => {
  it('adds up the period after returns, with profit from the cost at the time of sale', async () => {
    const { walkIn, business, saleReturn, rice } = await trade();
    const res = await m().get('/api/reports/dashboard');
    expect(res.status).toBe(200);
    const d = res.body.dashboard;
    expect(d.period.to).toBe(today);
    expect(d.daily).toHaveLength(30);

    const taxable = walkIn.taxable + business.taxable - saleReturn.taxable;
    // Cost: two rice (₹1,000) and a soap (₹120), less the rice that went back on the shelf.
    const cost = 100000 + 12000 - 50000;
    expect(d.totals).toMatchObject({
      bills: 2,
      grossSales: 141400,
      refunds: 61700,
      returns: 1,
      netSales: 79700,
      netTaxable: taxable,
      netTax: walkIn.totalTax + business.totalTax - saleReturn.totalTax,
      costOfGoods: cost,
      grossProfit: taxable - cost,
      margin: Math.round(((taxable - cost) / taxable) * 1000) / 10,
      averageBill: 39850,
    });
    expect(d.daily.at(-1)).toMatchObject({ date: today, bills: 2, netSales: 79700 });
    expect(d.previousTotals).toMatchObject({ bills: 0, netSales: 0, margin: null });

    expect(d.topProducts.map((p: { product: { name: string } }) => p.product.name)).toEqual([
      'Basmati Rice 5 kg',
      'Bath Soap',
    ]);
    expect(d.topProducts[0]).toMatchObject({ quantity: 1, sales: 61700 });
    expect(d.payments).toEqual([
      { method: 'cash', bills: 1, amount: 123400 },
      { method: 'upi', bills: 1, amount: 18000 },
    ]);
    // Soap is down to 4 against a reorder level of 5.
    expect(d.stock.needsRestock).toEqual([
      expect.objectContaining({ name: 'Bath Soap', stock: 4, reorderLevel: 5, onOrder: 0 }),
    ]);
    expect(d.stock.costValue).toBe(
      19 * rice.costPrice + 4 * 12000 + 20 * 7000, // rice back on the shelf, pens received
    );
  });

  it('is for managers only and checks the period', async () => {
    expect((await as(cashier).get('/api/reports/dashboard')).status).toBe(403);
    expect((await as(cashier).get('/api/reports/sales')).status).toBe(403);
    const bad = await m().get('/api/reports/dashboard?from=2026-10-10&to=2026-10-01');
    expect(bad.status).toBe(400);
    expect((await m().get('/api/reports/profit')).status).toBe(404);
  });
});

describe('reports', () => {
  it('groups sales by month with payments and cashiers', async () => {
    await trade();
    const res = await m().get(`/api/reports/sales?from=${today}&to=${today}&groupBy=month`);
    expect(res.status).toBe(200);
    const r = res.body.report;
    const [periods, payments, cashiers] = r.sections;
    expect(periods.rows).toHaveLength(1);
    expect(periods.rows[0]).toMatchObject({ bills: 2, netSales: 79700, refunds: 61700 });
    expect(periods.totals).toMatchObject({ period: 'Total', netSales: 79700 });
    expect(payments.rows[0]).toMatchObject({ method: 'Cash', amount: 123400, share: 87.3 });
    expect(cashiers.rows).toEqual([
      expect.objectContaining({ cashier: expect.any(String), bills: 2, sales: 141400 }),
    ]);
    expect(r.highlights[0]).toEqual({ label: 'Net sales', value: 79700, type: 'money' });
  });

  it('ranks products and filters by category', async () => {
    const { other } = await trade();
    const r = (await m().get(`/api/reports/products?from=${today}&to=${today}&sort=profit`)).body
      .report;
    const rows = r.sections[0].rows;
    expect(rows.map((p: { product: string }) => p.product)).toEqual([
      'Basmati Rice 5 kg',
      'Bath Soap',
    ]);
    expect(rows[0]).toMatchObject({ sold: 2, returned: 1, sales: 61700, cost: 50000 });
    expect(r.sections[1].rows[0]).toMatchObject({ category: 'Staples', products: 2 });
    const none = await m().get(
      `/api/reports/products?from=${today}&to=${today}&category=${String(other._id)}`,
    );
    expect(none.body.report.sections[0].rows).toEqual([]);
  });

  it('summarises GST: B2B and B2C, HSN, credit notes and input tax set off against output tax', async () => {
    const { walkIn, business, saleReturn } = await trade();
    const r = (await m().get(`/api/reports/gst?from=${today}&to=${today}`)).body.report;
    const section = (id: string) => r.sections.find((s: { id: string }) => s.id === id);

    expect(section('rates').rows).toEqual([
      expect.objectContaining({
        rate: 5,
        type: 'B2C',
        taxable: walkIn.taxable - saleReturn.taxable,
      }),
      expect.objectContaining({ rate: 18, type: 'B2B', igst: business.igst, cgst: 0 }),
    ]);
    expect(section('b2b').rows).toEqual([
      expect.objectContaining({
        invoice: business.invoiceNumber,
        customer: 'Western Traders',
        placeOfSupply: '27-Maharashtra',
        total: 18000,
      }),
    ]);
    expect(section('credit-notes').rows[0]).toMatchObject({
      number: saleReturn.returnNumber,
      invoice: walkIn.invoiceNumber,
      refund: 61700,
    });
    expect(
      section('hsn').rows.map((h: { hsn: string; quantity: number }) => [h.hsn, h.quantity]),
    ).toEqual([
      ['1006', 1],
      ['3401', 1],
    ]);
    // ₹700 of pens at 18%: ₹63 CGST + ₹63 SGST of input tax.
    expect(section('itc').rows).toEqual([
      expect.objectContaining({
        invoice: 'KS-778',
        taxable: 70000,
        cgst: 6300,
        sgst: 6300,
        igst: 0,
      }),
    ]);
    // CGST credit pays the CGST and then the IGST; SGST credit pays the SGST. Nothing is due in
    // cash and the rest carries forward.
    const summary = section('summary');
    expect(summary.totals).toMatchObject({
      head: 'GST payable in cash',
      cgst: 0,
      sgst: 0,
      igst: 0,
    });
    const carried = summary.rows.find(
      (row: { head: string }) => row.head === 'Credit carried forward',
    );
    const localCgst = walkIn.cgst - saleReturn.cgst;
    expect(carried).toMatchObject({
      cgst: 6300 - localCgst - business.igst,
      sgst: 6300 - (walkIn.sgst - saleReturn.sgst),
      igst: 0,
    });
  });

  it('values stock and spots slow movers', async () => {
    await trade();
    const r = (await m().get('/api/reports/stock')).body.report;
    expect(r.subtitle).toMatch(/^As of /);
    const byName = Object.fromEntries(
      r.sections[0].rows.map((row: { product: string }) => [row.product, row]),
    );
    expect(byName['Bath Soap']).toMatchObject({ status: 'low', stock: 4, sold30: 1 });
    expect(byName['=Gel Pens']).toMatchObject({
      status: 'dead',
      costValue: 140000,
      lastSold: 'Never',
    });
    expect(byName['Basmati Rice 5 kg']).toMatchObject({ status: 'ok', sold30: 2, cover: 285 });
    const dead = (await m().get('/api/reports/stock?stock=dead')).body.report.sections[0].rows;
    expect(dead.map((row: { product: string }) => row.product)).toEqual(['=Gel Pens']);
  });

  it('exports a table as CSV for spreadsheets and the whole report as PDF', async () => {
    await trade();
    const csv = await m().get('/api/reports/stock?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['content-disposition']).toBe(
      `attachment; filename="stock-report-${today}.csv"`,
    );
    const lines = csv.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(csv.text.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toContain('Product,SKU,Category,Status,In stock,Unit,Cost price (₹)');
    // Money in rupees, and a formula-like name made harmless.
    expect(lines.find((l) => l.includes('STN-002'))).toMatch(
      /^'=Gel Pens,STN-002,.*,70\.00,1400\.00,/,
    );
    expect(lines.at(-1)).toMatch(/^3 products,/);

    const hsn = await m().get(`/api/reports/gst?from=${today}&to=${today}&format=csv&section=hsn`);
    expect(hsn.headers['content-disposition']).toContain(`gst-report-${today}-to-${today}-hsn.csv`);
    expect((await m().get('/api/reports/gst?format=csv&section=nope')).status).toBe(404);

    const pdf = await m()
      .get(`/api/reports/gst?from=${today}&to=${today}&format=pdf`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const body = (pdf.body as Buffer).toString('latin1');
    expect(body.startsWith('%PDF-')).toBe(true);
    expect(body).toContain('GST summary');
  });
});
