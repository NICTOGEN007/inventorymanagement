import { gstinCheckCharacter } from '@ims/shared';
import mongoose, { Types, type AnyObject } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  CategoryModel,
  CustomerModel,
  nextSequence,
  ProductModel,
  SaleModel,
  StockMovementModel,
  SupplierModel,
  UserModel,
} from '../src/models/index.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

const validGstin = (body: string) => body + gstinCheckCharacter(body);

function productInput(overrides: AnyObject = {}): AnyObject {
  return {
    sku: 'stp-001',
    name: 'Basmati Rice 5 kg',
    category: new Types.ObjectId(),
    unit: 'pcs',
    hsnCode: '1006',
    gstRate: 5,
    costPrice: 50000,
    sellingPrice: 61700,
    mrp: 64900,
    ...overrides,
  };
}

/** Resolves to the validation error messages, keyed by path. */
async function validationErrors(doc: mongoose.Document): Promise<Record<string, string>> {
  try {
    await doc.validate();
    return {};
  } catch (err) {
    if (!(err instanceof mongoose.Error.ValidationError)) throw err;
    return Object.fromEntries(Object.entries(err.errors).map(([path, e]) => [path, e.message]));
  }
}

describe('Product', () => {
  it('saves a valid product with defaults and normalised SKU', async () => {
    const product = await ProductModel.create(productInput());
    expect(product.sku).toBe('STP-001');
    expect(product.stock).toBe(0);
    expect(product.taxInclusive).toBe(true);
    expect(product.isActive).toBe(true);
  });

  it('serialises with `id` and without internal fields', async () => {
    const json = (await ProductModel.create(productInput())).toJSON() as Record<string, unknown>;
    expect(json.id).toEqual(expect.any(String));
    expect(json).not.toHaveProperty('_id');
    expect(json).not.toHaveProperty('__v');
    expect(json.isLowStock).toBe(true);
  });

  it('rejects invalid GST rates, fractional paise and negative stock', async () => {
    const errors = await validationErrors(
      new ProductModel(productInput({ gstRate: 12, costPrice: 100.5, stock: -1 })),
    );
    expect(errors.gstRate).toMatch(/not a valid GST rate/);
    expect(errors.costPrice).toMatch(/whole number of paise/);
    expect(errors.stock).toMatch(/cannot go negative/);
  });

  it('rejects a selling price above MRP for tax-inclusive pricing', async () => {
    const errors = await validationErrors(new ProductModel(productInput({ sellingPrice: 70000 })));
    expect(errors.sellingPrice).toMatch(/cannot exceed MRP/);
  });

  it('validates HSN codes', async () => {
    const errors = await validationErrors(new ProductModel(productInput({ hsnCode: '10060' })));
    expect(errors.hsnCode).toBe('Invalid HSN code');
  });

  it('enforces unique SKUs', async () => {
    await ProductModel.create(productInput());
    await expect(ProductModel.create(productInput({ sku: 'STP-001' }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('enforces unique barcodes but allows many products without one', async () => {
    await ProductModel.create(productInput({ sku: 'A-001' }));
    await ProductModel.create(productInput({ sku: 'A-002' }));
    await ProductModel.create(productInput({ sku: 'A-003', barcode: '2100000000017' }));
    await expect(
      ProductModel.create(productInput({ sku: 'A-004', barcode: '2100000000017' })),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe('User', () => {
  it('never exposes the password hash', async () => {
    const created = await UserModel.create({
      name: 'Asha Rao',
      email: 'Admin@Example.com',
      passwordHash: 'hash',
      role: 'admin',
    });
    expect(created.email).toBe('admin@example.com');
    expect(created.toJSON()).not.toHaveProperty('passwordHash');

    const loaded = await UserModel.findById(created._id);
    expect(loaded?.passwordHash).toBeUndefined();
    const withHash = await UserModel.findById(created._id).select('+passwordHash');
    expect(withHash?.passwordHash).toBe('hash');
  });

  it('enforces unique emails case-insensitively', async () => {
    await UserModel.create({ name: 'A', email: 'a@example.com', passwordHash: 'x' });
    await expect(
      UserModel.create({ name: 'B', email: 'A@EXAMPLE.COM', passwordHash: 'x' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects unknown roles', async () => {
    const errors = await validationErrors(
      new UserModel({ name: 'A', email: 'a@example.com', passwordHash: 'x', role: 'owner' }),
    );
    expect(errors.role).toBeDefined();
  });
});

describe('Suppliers and customers', () => {
  it('accepts a valid GSTIN that matches the state', async () => {
    const supplier = await SupplierModel.create({
      name: 'Karnataka Agro',
      gstin: validGstin('29AAFFK2345M1Z'),
      stateCode: '29',
    });
    expect(supplier.leadTimeDays).toBe(7);
  });

  it('rejects a GSTIN with a wrong check character', async () => {
    const body = '29AAFFK2345M1Z';
    const wrong = body + (gstinCheckCharacter(body) === 'A' ? 'B' : 'A');
    const errors = await validationErrors(
      new SupplierModel({ name: 'X', gstin: wrong, stateCode: '29' }),
    );
    expect(errors.gstin).toMatch(/not a valid GSTIN/);
  });

  it('rejects a GSTIN from a different state', async () => {
    const errors = await validationErrors(
      new CustomerModel({ name: 'Y', gstin: validGstin('27AAFFW5678Q1Z'), stateCode: '29' }),
    );
    expect(errors.gstin).toMatch(/does not match/);
  });

  it('validates Indian mobile numbers and PIN codes', async () => {
    const errors = await validationErrors(
      new CustomerModel({ name: 'Z', phone: '12345', address: { pincode: '012345' } }),
    );
    expect(errors.phone).toMatch(/10-digit/);
    expect(errors['address.pincode']).toBe('Invalid PIN code');
  });

  it('treats category names as case-insensitive', async () => {
    await CategoryModel.create({ name: 'Beverages' });
    await expect(CategoryModel.create({ name: 'beverages' })).rejects.toMatchObject({
      code: 11000,
    });
  });
});

describe('Sale', () => {
  const sale = (overrides: AnyObject = {}) =>
    new SaleModel({
      invoiceNumber: 'INV/26-27/00001',
      placeOfSupply: '29',
      interState: false,
      items: [
        {
          product: new Types.ObjectId(),
          name: 'Milk',
          sku: 'DRY-001',
          hsnCode: '0401',
          unit: 'pcs',
          quantity: 2,
          unitPrice: 5600,
          taxInclusive: true,
          gstRate: 0,
          taxable: 11200,
          cgst: 0,
          sgst: 0,
          igst: 0,
          total: 11200,
          unitCost: 5000,
        },
      ],
      gross: 11200,
      discount: 0,
      taxable: 11200,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      roundOff: 0,
      grandTotal: 11200,
      payments: [{ method: 'cash', amount: 11200 }],
      cashier: new Types.ObjectId(),
      ...overrides,
    });

  it('accepts a consistent sale', async () => {
    expect(await validationErrors(sale())).toEqual({});
  });

  it('requires payments to add up to the grand total', async () => {
    const errors = await validationErrors(sale({ payments: [{ method: 'upi', amount: 10000 }] }));
    expect(errors.payments).toMatch(/must equal the grand total/);
  });

  it('requires at least one item', async () => {
    const errors = await validationErrors(sale({ items: [] }));
    expect(errors.items).toMatch(/At least one item/);
  });

  it('allows at most three decimals in quantities', async () => {
    const doc = sale();
    doc.items[0]!.quantity = 1.2345;
    const errors = await validationErrors(doc);
    expect(errors['items.0.quantity']).toMatch(/3 decimal places/);
  });
});

describe('StockMovement', () => {
  it('requires a reason for adjustments and a non-zero quantity', async () => {
    const errors = await validationErrors(
      new StockMovementModel({
        product: new Types.ObjectId(),
        type: 'adjustment',
        quantity: 0,
        balanceAfter: 5,
      }),
    );
    expect(errors.reason).toMatch(/reason is required/);
    expect(errors.quantity).toMatch(/cannot be zero/);
  });
});

describe('Counters and transactions', () => {
  it('hands out unique, gap-free numbers under concurrency', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 25 }, () => nextSequence('invoice:26-27')),
    );
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('rolls back every write when a transaction aborts', async () => {
    const category = await CategoryModel.create({ name: 'Dairy' });
    await expect(
      mongoose.connection.transaction(async (session) => {
        await ProductModel.create([productInput({ category: category._id })], { session });
        await nextSequence('invoice:rollback', session);
        throw new Error('payment failed');
      }),
    ).rejects.toThrow('payment failed');

    expect(await ProductModel.countDocuments()).toBe(0);
    expect(await nextSequence('invoice:rollback')).toBe(1);
  });
});
