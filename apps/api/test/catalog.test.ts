import { gstinCheckCharacter } from '@ims/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  AuditLogModel,
  CategoryModel,
  ProductModel,
  PurchaseOrderModel,
  StockMovementModel,
  SupplierModel,
} from '../src/models/index.js';
import { signedIn } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

const gstin = (body: string) => body + gstinCheckCharacter(body);

let app: ReturnType<typeof createApp>;
let manager: string;
let cashier: string;

beforeEach(async () => {
  app = createApp();
  manager = (await signedIn(app, 'manager')).bearer;
  cashier = (await signedIn(app, 'cashier')).bearer;
});

const api = (auth: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', auth),
  post: (url: string, body: object) => request(app).post(url).set('Authorization', auth).send(body),
  patch: (url: string, body: object) =>
    request(app).patch(url).set('Authorization', auth).send(body),
  put: (url: string, body: object) => request(app).put(url).set('Authorization', auth).send(body),
  delete: (url: string) => request(app).delete(url).set('Authorization', auth),
});

async function seedCatalog() {
  const dairy = await CategoryModel.create({ name: 'Dairy' });
  const snacks = await CategoryModel.create({ name: 'Snacks' });
  const supplier = await SupplierModel.create({
    name: 'Greenfield Dairy',
    stateCode: '29',
    leadTimeDays: 1,
  });
  const base = {
    unit: 'pcs',
    hsnCode: '0401',
    gstRate: 0,
    costPrice: 5000,
    sellingPrice: 5600,
    taxInclusive: true,
  } as const;
  const milk = await ProductModel.create({
    ...base,
    sku: 'DRY-001',
    barcode: '2100000000017',
    name: 'Toned Milk 1 L',
    brand: 'Greenfield',
    category: dairy._id,
    preferredSupplier: supplier._id,
    stock: 40,
    reorderLevel: 20,
  });
  const curd = await ProductModel.create({
    ...base,
    sku: 'DRY-002',
    name: 'Curd 400 g',
    category: dairy._id,
    stock: 5,
    reorderLevel: 10,
  });
  const chips = await ProductModel.create({
    ...base,
    sku: 'SNK-001',
    name: 'Potato Chips',
    category: snacks._id,
    stock: 0,
    reorderLevel: 12,
  });
  const old = await ProductModel.create({
    ...base,
    sku: 'SNK-002',
    name: 'Old Snack',
    category: snacks._id,
    isActive: false,
  });
  return { dairy, snacks, supplier, milk, curd, chips, old };
}

const validProduct = (category: string) => ({
  sku: 'stp-001',
  barcode: '4006381333931',
  name: 'Basmati Rice 5 kg',
  category,
  brand: 'HarvestCrown',
  unit: 'pcs',
  hsnCode: '1006',
  gstRate: 5,
  costPrice: 52000,
  sellingPrice: 61700,
  mrp: 64900,
  taxInclusive: true,
  reorderLevel: 30,
  reorderQuantity: 66,
  openingStock: 50,
});

describe('categories', () => {
  it('lists categories with product counts for any signed-in role with products:read', async () => {
    await seedCatalog();
    const res = await api(cashier).get('/api/categories');
    expect(res.status).toBe(200);
    expect(
      res.body.data.map((c: { name: string; productCount: number }) => [c.name, c.productCount]),
    ).toEqual([
      ['Dairy', 2],
      ['Snacks', 2],
    ]);
  });

  it('lets managers create, rename and deactivate, but not cashiers', async () => {
    expect((await api(cashier).post('/api/categories', { name: 'Bakery' })).status).toBe(403);
    const created = await api(manager).post('/api/categories', {
      name: ' Bakery ',
      description: 'Bread & buns',
    });
    expect(created.status).toBe(201);
    expect(created.body.category).toMatchObject({
      name: 'Bakery',
      productCount: 0,
      isActive: true,
    });

    const id = created.body.category.id;
    const updated = await api(manager).patch(`/api/categories/${id}`, {
      name: 'Bakery & Cakes',
      isActive: false,
    });
    expect(updated.body.category).toMatchObject({ name: 'Bakery & Cakes', isActive: false });
    expect(await AuditLogModel.countDocuments({ entity: 'Category' })).toBe(2);
  });

  it('rejects duplicate names regardless of case, with the field named', async () => {
    await CategoryModel.create({ name: 'Dairy' });
    const res = await api(manager).post('/api/categories', { name: 'DAIRY' });
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].path).toEqual(['name']);
  });

  it('deletes only unused categories', async () => {
    const { dairy } = await seedCatalog();
    expect((await api(manager).delete(`/api/categories/${dairy._id}`)).status).toBe(409);
    const empty = await CategoryModel.create({ name: 'Empty' });
    expect((await api(manager).delete(`/api/categories/${empty._id}`)).status).toBe(204);
    expect((await api(manager).delete(`/api/categories/${empty._id}`)).status).toBe(404);
  });
});

describe('suppliers', () => {
  const supplier = {
    name: 'Karnataka Agro Distributors',
    contactPerson: 'Manjunath K',
    phone: '9845012345',
    email: 'Orders@KAAgro.test',
    gstin: gstin('29AAFFK2345M1Z').toLowerCase(),
    stateCode: '29',
    address: { city: 'Bengaluru', pincode: '560002' },
    leadTimeDays: 3,
  };

  it('is visible to managers and hidden from cashiers', async () => {
    await SupplierModel.create({ name: 'A', stateCode: '29', leadTimeDays: 2 });
    expect((await api(cashier).get('/api/suppliers')).status).toBe(403);
    expect((await api(manager).get('/api/suppliers')).body.data).toHaveLength(1);
  });

  it('creates a supplier with normalised fields', async () => {
    const res = await api(manager).post('/api/suppliers', supplier);
    expect(res.status).toBe(201);
    expect(res.body.supplier).toMatchObject({
      email: 'orders@kaagro.test',
      gstin: gstin('29AAFFK2345M1Z'),
      address: { city: 'Bengaluru', pincode: '560002' },
      productCount: 0,
    });
  });

  it('rejects a GSTIN from another state and invalid contact details', async () => {
    const res = await api(manager).post('/api/suppliers', {
      ...supplier,
      stateCode: '27',
      phone: '12345',
    });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string[] }) => d.path[0]);
    expect(paths).toContain('phone');
  });

  it('replaces the whole record on update, clearing removed fields', async () => {
    const id = (await api(manager).post('/api/suppliers', supplier)).body.supplier.id;
    const res = await api(manager).put(`/api/suppliers/${id}`, {
      name: 'KA Agro',
      stateCode: '29',
      leadTimeDays: 4,
    });
    expect(res.status).toBe(200);
    expect(res.body.supplier).toEqual(
      expect.objectContaining({ name: 'KA Agro', leadTimeDays: 4 }),
    );
    expect(res.body.supplier.gstin).toBeUndefined();
    expect(res.body.supplier.phone).toBeUndefined();
  });

  it('searches by name, contact or GSTIN', async () => {
    await api(manager).post('/api/suppliers', supplier);
    await SupplierModel.create({ name: 'Coastal Beverages', stateCode: '29', leadTimeDays: 4 });
    const res = await api(manager).get('/api/suppliers?search=manju');
    expect(res.body.data.map((s: { name: string }) => s.name)).toEqual([
      'Karnataka Agro Distributors',
    ]);
  });

  it('deletes only suppliers without products or orders', async () => {
    const { supplier: used } = await seedCatalog();
    expect((await api(manager).delete(`/api/suppliers/${used._id}`)).status).toBe(409);

    const ordered = await SupplierModel.create({
      name: 'Has orders',
      stateCode: '29',
      leadTimeDays: 2,
    });
    await PurchaseOrderModel.create({
      poNumber: 'PO/26-27/00001',
      supplier: ordered._id,
      interState: false,
      items: [
        {
          product: used._id,
          name: 'x',
          quantity: 1,
          unitCost: 1,
          gstRate: 0,
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
    expect((await api(manager).delete(`/api/suppliers/${ordered._id}`)).status).toBe(409);

    const unused = await SupplierModel.create({ name: 'Unused', stateCode: '29', leadTimeDays: 2 });
    expect((await api(manager).delete(`/api/suppliers/${unused._id}`)).status).toBe(204);
  });
});

describe('products', () => {
  it('lists active products by name with category, supplier and stock status', async () => {
    await seedCatalog();
    const res = await api(cashier).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual([
      'Curd 400 g',
      'Potato Chips',
      'Toned Milk 1 L',
    ]);
    expect(res.body.data[2]).toMatchObject({
      category: { name: 'Dairy' },
      preferredSupplier: { name: 'Greenfield Dairy' },
      stockStatus: 'ok',
      onOrder: 0,
    });
  });

  it('filters by search, category, stock status and active status', async () => {
    const { snacks } = await seedCatalog();
    const names = async (query: string) =>
      (await api(manager).get(`/api/products?${query}`)).body.data.map(
        (p: { name: string }) => p.name,
      );

    expect(await names('search=milk')).toEqual(['Toned Milk 1 L']);
    expect(await names('search=2100000000017')).toEqual(['Toned Milk 1 L']);
    expect(await names('search=dry-')).toEqual(['Curd 400 g', 'Toned Milk 1 L']);
    expect(await names(`category=${snacks._id}`)).toEqual(['Potato Chips']);
    expect(await names('stock=low')).toEqual(['Curd 400 g']);
    expect(await names('stock=out')).toEqual(['Potato Chips']);
    expect(await names('stock=ok')).toEqual(['Toned Milk 1 L']);
    expect(await names('status=inactive')).toEqual(['Old Snack']);
    expect(await names('status=all&sort=-stock')).toEqual([
      'Toned Milk 1 L',
      'Curd 400 g',
      'Potato Chips',
      'Old Snack',
    ]);
    expect((await api(manager).get('/api/products?sort=passwordHash')).status).toBe(400);
  });

  it('paginates', async () => {
    await seedCatalog();
    const page2 = await api(manager).get('/api/products?pageSize=2&page=2');
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page2.body.data.map((p: { name: string }) => p.name)).toEqual(['Toned Milk 1 L']);
  });

  it('shows quantities still to arrive on open purchase orders', async () => {
    const { milk, supplier } = await seedCatalog();
    const item = {
      product: milk._id,
      name: 'Milk',
      unitCost: 5000,
      gstRate: 0,
      taxable: 1,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: 1,
    };
    const po = (
      poNumber: string,
      status: 'ordered' | 'partially_received' | 'received',
      quantity: number,
      receivedQuantity: number,
    ) =>
      PurchaseOrderModel.create({
        poNumber,
        supplier: supplier._id,
        status,
        interState: false,
        items: [{ ...item, quantity, receivedQuantity }],
        taxable: 1,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 1,
      });
    await po('PO/26-27/00001', 'ordered', 48, 0);
    await po('PO/26-27/00002', 'partially_received', 24, 10);
    await po('PO/26-27/00003', 'received', 100, 100);
    const res = await api(manager).get(`/api/products/${milk._id}`);
    expect(res.body.product.onOrder).toBe(62);
  });

  it('finds a product by barcode or SKU for the POS', async () => {
    await seedCatalog();
    expect(
      (await api(cashier).get('/api/products/lookup?code=2100000000017')).body.product.sku,
    ).toBe('DRY-001');
    expect((await api(cashier).get('/api/products/lookup?code=dry-002')).body.product.name).toBe(
      'Curd 400 g',
    );
    expect((await api(cashier).get('/api/products/lookup?code=SNK-002')).status).toBe(404); // inactive
  });

  it('creates a product and records its opening stock in the ledger', async () => {
    const { dairy } = await seedCatalog();
    const res = await api(manager).post('/api/products', validProduct(String(dairy._id)));
    expect(res.status).toBe(201);
    expect(res.body.product).toMatchObject({
      sku: 'STP-001',
      stock: 50,
      stockStatus: 'ok',
      category: { name: 'Dairy' },
    });

    const movements = await StockMovementModel.find({ product: res.body.product.id }).lean();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: 'opening',
      quantity: 50,
      balanceAfter: 50,
      unitCost: 52000,
    });
    expect(await AuditLogModel.countDocuments({ action: 'product.create' })).toBe(1);
  });

  it('does not create a ledger entry when there is no opening stock', async () => {
    const { dairy } = await seedCatalog();
    const res = await api(manager).post('/api/products', {
      ...validProduct(String(dairy._id)),
      openingStock: 0,
    });
    expect(res.body.product.stock).toBe(0);
    expect(await StockMovementModel.countDocuments({ product: res.body.product.id })).toBe(0);
  });

  it('rejects invalid products with field errors', async () => {
    const { dairy } = await seedCatalog();
    const res = await api(manager).post('/api/products', {
      ...validProduct(String(dairy._id)),
      barcode: '4006381333932',
      gstRate: 12,
      sellingPrice: 70000,
    });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string[] }) => d.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['barcode', 'gstRate']));
  });

  it('reports unknown categories and duplicate SKUs or barcodes on the right field', async () => {
    const { dairy } = await seedCatalog();
    const missing = await api(manager).post(
      '/api/products',
      validProduct('507f1f77bcf86cd799439011'),
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toEqual(['category']);

    const dupSku = await api(manager).post('/api/products', {
      ...validProduct(String(dairy._id)),
      sku: 'dry-001',
      barcode: '',
    });
    expect(dupSku.status).toBe(409);
    expect(dupSku.body.error.details[0]).toEqual({
      path: ['sku'],
      message: 'SKU is already in use',
    });
    const dupBarcode = await api(manager).post('/api/products', {
      ...validProduct(String(dairy._id)),
      barcode: '2100000000017',
    });
    expect(dupBarcode.body.error.details[0].path).toEqual(['barcode']);
    // Nothing half-written: the failed creates left no ledger entries.
    expect(await StockMovementModel.countDocuments()).toBe(0);
  });

  it('is read-only for cashiers', async () => {
    const { dairy, milk } = await seedCatalog();
    expect((await api(cashier).post('/api/products', validProduct(String(dairy._id)))).status).toBe(
      403,
    );
    expect((await api(cashier).patch(`/api/products/${milk._id}`, { name: 'x' })).status).toBe(403);
  });

  it('updates fields, audits price changes and can clear optional fields', async () => {
    const { milk } = await seedCatalog();
    const res = await api(manager).patch(`/api/products/${milk._id}`, {
      sellingPrice: 5800,
      brand: '',
      barcode: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.product.sellingPrice).toBe(5800);
    expect(res.body.product.brand).toBeUndefined();
    expect(res.body.product.barcode).toBeUndefined();

    const log = await AuditLogModel.findOne({ action: 'product.update' }).lean();
    expect(log?.details).toMatchObject({
      priceChanges: { sellingPrice: { from: 5600, to: 5800 } },
    });
  });

  it('never lets stock be edited directly', async () => {
    const { milk } = await seedCatalog();
    const res = await api(manager).patch(`/api/products/${milk._id}`, { stock: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/stock adjustment/);
    expect((await ProductModel.findById(milk._id))?.stock).toBe(40);
  });

  it('checks the MRP rule against the stored values on partial updates', async () => {
    const { milk } = await seedCatalog();
    await api(manager).patch(`/api/products/${milk._id}`, { mrp: 6000 });
    const res = await api(manager).patch(`/api/products/${milk._id}`, { sellingPrice: 6500 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toEqual(['sellingPrice']);
  });

  it('answers 404 for unknown or malformed ids', async () => {
    expect((await api(manager).get('/api/products/507f1f77bcf86cd799439011')).status).toBe(404);
    expect((await api(manager).get('/api/products/nope')).status).toBe(404);
  });
});
