import { gstinCheckCharacter } from '@ims/shared';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  AuditLogModel,
  CategoryModel,
  CustomerModel,
  ProductModel,
  SettingsModel,
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
const api = {
  get: (url: string) => request(app).get(url).set('Authorization', cashier),
  post: (url: string, body: object) =>
    request(app).post(url).set('Authorization', cashier).send(body),
  put: (url: string, body: object) =>
    request(app).put(url).set('Authorization', cashier).send(body),
  delete: (url: string) => request(app).delete(url).set('Authorization', cashier),
};

describe('customers', () => {
  it('adds a customer, fills the state from the GSTIN and refuses a second record for a phone', async () => {
    const res = await api.post('/api/customers', {
      name: 'Hosur Mini Mart',
      phone: '9443012345',
      gstin: gstin('33AABCH1234K1Z'),
      email: '',
      address: { city: 'Hosur', pincode: '635109' },
    });
    expect(res.status).toBe(201);
    expect(res.body.customer).toMatchObject({
      name: 'Hosur Mini Mart',
      stateCode: '33',
      isActive: true,
      address: { city: 'Hosur', pincode: '635109' },
      stats: { visits: 0, totalSpent: 0, averageBill: 0, returns: 0 },
      topProducts: [],
    });
    expect(res.body.customer.email).toBeUndefined();
    expect(await AuditLogModel.exists({ action: 'customer.create' })).toBeTruthy();

    const twin = await api.post('/api/customers', { name: 'Someone Else', phone: '9443012345' });
    expect(twin.status).toBe(409);
    expect(twin.body.error.details[0].path).toEqual(['phone']);

    const bad = await api.post('/api/customers', {
      name: 'Mismatch',
      gstin: gstin('33AABCH1234K1Z'),
      stateCode: '29',
    });
    expect(bad.status).toBe(400);
  });

  it('shows what a customer spent, net of returns, and what they buy most', async () => {
    await SettingsModel.create({
      shopName: 'Demo Mart',
      gstin: gstin('29AABCS1234K1Z'),
      stateCode: '29',
    });
    const category = await CategoryModel.create({ name: 'Staples' });
    const product = (sku: string, name: string, sellingPrice: number) =>
      ProductModel.create({
        sku,
        name,
        category: category._id,
        hsnCode: '1006',
        unit: 'pcs',
        gstRate: 5,
        costPrice: 1000,
        sellingPrice,
        taxInclusive: true,
        reorderLevel: 1,
        stock: 50,
      });
    const rice = await product('STP-001', 'Rice', 10000);
    const dal = await product('STP-002', 'Dal', 5000);
    const customer = (await api.post('/api/customers', { name: 'Asha Rao', phone: '9845012345' }))
      .body.customer;
    const sell = (items: { product: string; quantity: number }[], amount: number) =>
      api.post('/api/sales', {
        customer: customer.id,
        items,
        payments: [{ method: 'cash', amount }],
      });

    const first = await sell([{ product: String(rice._id), quantity: 2 }], 20000);
    await sell(
      [
        { product: String(dal._id), quantity: 1 },
        { product: String(rice._id), quantity: 1 },
      ],
      15000,
    );
    await api.post('/api/returns', {
      sale: first.body.sale.id,
      items: [{ product: String(rice._id), quantity: 1 }],
      refundMethod: 'cash',
      reason: 'Bought one too many',
    });

    const res = await api.get(`/api/customers/${customer.id}`);
    expect(res.status).toBe(200);
    expect(res.body.customer.stats).toMatchObject({
      visits: 2,
      totalSpent: 25000,
      averageBill: 12500,
      returns: 1,
      refunded: 10000,
      lastPurchaseAt: expect.any(String),
    });
    expect(res.body.customer.topProducts).toEqual([
      { product: { id: String(rice._id), name: 'Rice', unit: 'pcs' }, quantity: 2, total: 20000 },
      { product: { id: String(dal._id), name: 'Dal', unit: 'pcs' }, quantity: 1, total: 5000 },
    ]);

    const list = await api.get('/api/customers?search=asha');
    expect(list.body.data[0]).toMatchObject({
      name: 'Asha Rao',
      stats: { visits: 2, totalSpent: 25000 },
    });
    const history = await api.get(`/api/sales?customer=${customer.id}`);
    expect(history.body.total).toBe(2);
    const returns = await api.get(`/api/returns?customer=${customer.id}`);
    expect(returns.body.total).toBe(1);

    // A customer with bills cannot be deleted, only deactivated.
    expect((await api.delete(`/api/customers/${customer.id}`)).status).toBe(409);
  });

  it('edits and deactivates customers, hides them from the till and deletes unused ones', async () => {
    const asha = await CustomerModel.create({
      name: 'Asha Rao',
      phone: '9845012345',
      email: 'a@x.in',
    });
    const ravi = await CustomerModel.create({ name: 'Ravi Kumar' });

    const edited = await api.put(`/api/customers/${String(asha._id)}`, {
      name: 'Asha R.',
      phone: '9845012345',
      isActive: false,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.customer).toMatchObject({ name: 'Asha R.', isActive: false });
    // Fields left out of the form are cleared.
    expect(edited.body.customer.email).toBeUndefined();

    const active = await api.get('/api/customers');
    expect(active.body.data.map((c: { name: string }) => c.name)).toEqual(['Ravi Kumar']);
    const inactive = await api.get('/api/customers?status=inactive');
    expect(inactive.body.data.map((c: { name: string }) => c.name)).toEqual(['Asha R.']);
    expect((await api.get('/api/customers?status=all')).body.total).toBe(2);

    expect((await api.delete(`/api/customers/${String(ravi._id)}`)).status).toBe(204);
    expect(await CustomerModel.exists({ _id: ravi._id })).toBeNull();
    expect((await api.get(`/api/customers/${String(ravi._id)}`)).status).toBe(404);
  });
});
