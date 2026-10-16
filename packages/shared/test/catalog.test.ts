import { describe, expect, it } from 'vitest';
import { gtinCheckDigit, isValidGtin } from '../src/barcode.js';
import { gstinCheckCharacter } from '../src/gst.js';
import { priceBreakdown, stockStatus } from '../src/pricing.js';
import {
  categoryInputSchema,
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
  supplierInputSchema,
} from '../src/schemas/catalog.js';

describe('barcodes', () => {
  it('validates GTIN check digits for all common lengths', () => {
    expect(isValidGtin('4006381333931')).toBe(true); // EAN-13
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('40063813339a1')).toBe(false);
    expect(gtinCheckDigit('210000000001')).toBe(2);
  });
});

describe('priceBreakdown', () => {
  it('splits a tax-inclusive price', () => {
    expect(
      priceBreakdown({ sellingPrice: 11800, costPrice: 8000, gstRate: 18, taxInclusive: true }),
    ).toEqual({
      taxable: 10000,
      gst: 1800,
      priceWithTax: 11800,
      margin: 2000,
      marginPercent: 20,
    });
  });

  it('adds tax to a tax-exclusive price', () => {
    expect(
      priceBreakdown({ sellingPrice: 10000, costPrice: 9000, gstRate: 5, taxInclusive: false }),
    ).toMatchObject({
      taxable: 10000,
      gst: 500,
      priceWithTax: 10500,
      marginPercent: 10,
    });
  });

  it('reports a loss as a negative margin', () => {
    expect(
      priceBreakdown({ sellingPrice: 5000, costPrice: 6000, gstRate: 0, taxInclusive: true })
        .margin,
    ).toBe(-1000);
  });
});

describe('stockStatus', () => {
  it('classifies stock against the reorder level', () => {
    expect(stockStatus(0, 10)).toBe('out');
    expect(stockStatus(10, 10)).toBe('low');
    expect(stockStatus(11, 10)).toBe('ok');
  });
});

const category = '507f1f77bcf86cd799439011';
const validProduct = {
  sku: 'stp-011',
  name: 'Brown Rice 1 kg',
  category,
  unit: 'pcs',
  hsnCode: '1006',
  gstRate: 5,
  costPrice: 9000,
  sellingPrice: 12000,
  mrp: 12500,
  taxInclusive: true,
  reorderLevel: 10,
  reorderQuantity: 24,
};

describe('product schemas', () => {
  it('accepts a valid product and normalises it', () => {
    const p = productCreateSchema.parse({ ...validProduct, barcode: '', brand: '  ' });
    expect(p.sku).toBe('STP-011');
    expect(p.barcode).toBeUndefined();
    expect(p.brand).toBeUndefined();
    expect(p.openingStock).toBe(0);
  });

  it('rejects bad codes, rates and prices', () => {
    const r = productCreateSchema.safeParse({
      ...validProduct,
      sku: 'a',
      barcode: '4006381333932',
      hsnCode: '10',
      gstRate: 12,
      costPrice: 10.5,
      sellingPrice: 13000,
    });
    const paths = new Set(r.error?.issues.map((i) => i.path[0]));
    expect(paths).toEqual(new Set(['sku', 'barcode', 'hsnCode', 'gstRate', 'costPrice']));
  });

  it('keeps the selling price within the MRP', () => {
    const r = productCreateSchema.safeParse({ ...validProduct, sellingPrice: 13000 });
    expect(r.error?.issues[0]).toMatchObject({ path: ['sellingPrice'] });
    expect(
      productCreateSchema.safeParse({ ...validProduct, sellingPrice: 13000, taxInclusive: false })
        .success,
    ).toBe(true);
  });

  it('refuses stock changes in updates', () => {
    expect(productUpdateSchema.safeParse({ name: 'New name' }).success).toBe(true);
    const r = productUpdateSchema.safeParse({ stock: 100 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/stock adjustment/);
  });

  it('parses list queries with defaults', () => {
    expect(productListQuerySchema.parse({ page: '2' })).toMatchObject({
      page: 2,
      pageSize: 20,
      sort: 'name',
      status: 'active',
    });
    expect(productListQuerySchema.safeParse({ sort: 'password' }).success).toBe(false);
  });
});

describe('supplier and category schemas', () => {
  const gstin = '29AAFFK2345M1Z' + gstinCheckCharacter('29AAFFK2345M1Z');

  it('accepts a supplier and requires the GSTIN to match the state', () => {
    expect(
      supplierInputSchema.safeParse({
        name: 'Agro',
        stateCode: '29',
        gstin: gstin.toLowerCase(),
        leadTimeDays: 3,
      }).success,
    ).toBe(true);
    const wrongState = supplierInputSchema.safeParse({
      name: 'Agro',
      stateCode: '27',
      gstin,
      leadTimeDays: 3,
    });
    expect(wrongState.error?.issues[0]).toMatchObject({ path: ['gstin'] });
  });

  it('treats blank optional fields as not set', () => {
    const s = supplierInputSchema.parse({
      name: 'Agro',
      stateCode: '29',
      leadTimeDays: 2,
      phone: '',
      email: '',
    });
    expect(s.phone).toBeUndefined();
    expect(s.email).toBeUndefined();
  });

  it('validates category names', () => {
    expect(categoryInputSchema.safeParse({ name: 'D' }).success).toBe(false);
    expect(categoryInputSchema.parse({ name: ' Dairy ', description: '' })).toEqual({
      name: 'Dairy',
    });
  });
});
