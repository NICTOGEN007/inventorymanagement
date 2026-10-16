import { financialYear, isValidGstin } from '@ims/shared';
import { describe, expect, it } from 'vitest';
import {
  CounterModel,
  ProductModel,
  SaleModel,
  StockMovementModel,
  UserModel,
} from '../src/models/index.js';
import { PRODUCTS } from '../src/seed/catalog.js';
import { generateDataset, type Dataset } from '../src/seed/generate.js';
import { resetDatabase, writeDataset } from '../src/seed/write.js';
import { verifyPassword } from '../src/utils/password.js';
import { useTestDatabase } from './helpers/db.js';

const NOW = new Date('2026-10-16T09:30:00Z'); // 15:00 IST
const data: Dataset = generateDataset({ days: 400, seed: 7, now: NOW });

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('generateDataset', () => {
  it('is deterministic for the same options', () => {
    const again = generateDataset({ days: 400, seed: 7, now: NOW });
    expect(again.sales.length).toBe(data.sales.length);
    expect(again.sales.at(-1)).toEqual(data.sales.at(-1));
    expect(again.products.map((p) => p.stock)).toEqual(data.products.map((p) => p.stock));
  });

  it('produces a different history for a different seed', () => {
    const other = generateDataset({ days: 30, seed: 8, now: NOW });
    const same = generateDataset({ days: 30, seed: 7, now: NOW });
    expect(other.sales.map((s) => s.grandTotal)).not.toEqual(same.sales.map((s) => s.grandTotal));
  });

  it('rejects unreasonable lengths', () => {
    expect(() => generateDataset({ days: 3, seed: 1, now: NOW })).toThrow(RangeError);
  });

  it('never generates events in the future', () => {
    const latest = Math.max(
      ...data.sales.map((s) => s.soldAt.getTime()),
      ...data.stockMovements.map((m) => m.occurredAt.getTime()),
      ...data.saleReturns.map((r) => r.returnedAt.getTime()),
    );
    expect(latest).toBeLessThanOrEqual(NOW.getTime());
  });

  it('keeps every product stock equal to the sum of its movements, never negative', () => {
    for (const product of data.products) {
      const movements = data.stockMovements
        .filter((m) => m.product.equals(product._id))
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      let running = 0;
      for (const m of movements) {
        running = Math.round((running + m.quantity) * 1000) / 1000;
        expect(m.balanceAfter).toBe(running);
        expect(running).toBeGreaterThanOrEqual(0);
      }
      expect(product.stock).toBe(running);
    }
  });

  it('records one sale movement per invoice line', () => {
    const saleMovements = data.stockMovements.filter((m) => m.type === 'sale');
    expect(saleMovements).toHaveLength(sum(data.sales.map((s) => s.items.length)));
  });

  it('produces internally consistent invoices', () => {
    for (const sale of data.sales) {
      expect(sale.taxable).toBe(sum(sale.items.map((i) => i.taxable)));
      expect(sale.cgst + sale.sgst + sale.igst).toBe(sale.totalTax);
      expect(sale.taxable + sale.totalTax).toBe(sale.gross - sale.discount);
      expect(sale.grandTotal % 100).toBe(0);
      expect(sale.roundOff).toBeGreaterThanOrEqual(-50);
      expect(sale.roundOff).toBeLessThan(50);
      expect(sum(sale.payments.map((p) => p.amount))).toBe(sale.grandTotal);
      if (sale.interState) expect(sale.cgst + sale.sgst).toBe(0);
      else expect(sale.igst).toBe(0);
    }
    expect(data.sales.some((s) => s.interState)).toBe(true);
  });

  it('numbers invoices without gaps within each financial year', () => {
    const byYear = new Map<string, number[]>();
    for (const sale of data.sales) {
      const [, fy, seq] = sale.invoiceNumber.split('/');
      expect(fy).toBe(financialYear(sale.soldAt));
      byYear.set(fy!, [...(byYear.get(fy!) ?? []), Number(seq)]);
    }
    expect(byYear.size).toBe(2); // 400 days ending Oct 2026 span FY 25-26 and 26-27
    for (const [fy, numbers] of byYear) {
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
      expect(data.counters.find((c) => c._id === `invoice:${fy}`)?.seq).toBe(numbers.length);
    }
  });

  it('only returns what was sold, and refunds at most the line value', () => {
    expect(data.saleReturns.length).toBeGreaterThan(0);
    for (const r of data.saleReturns) {
      const sale = data.sales.find((s) => s._id.equals(r.sale))!;
      for (const item of r.items) {
        const line = sale.items.find((i) => i.product.equals(item.product))!;
        expect(line.returnedQuantity).toBeLessThanOrEqual(line.quantity);
        expect(item.total).toBeLessThanOrEqual(line.total);
      }
      expect(r.returnedAt.getTime()).toBeGreaterThan(sale.soldAt.getTime());
      expect(sale.status).not.toBe('completed');
    }
  });

  it('adds stock only when purchase orders are received', () => {
    for (const po of data.purchaseOrders) {
      const received = data.stockMovements.filter(
        (m) => m.type === 'purchase' && m.refId?.equals(po._id),
      );
      if (po.status === 'received') {
        expect(sum(received.map((m) => m.quantity))).toBe(sum(po.items.map((i) => i.quantity)));
        expect(po.receivedAt!.getTime()).toBeGreaterThan(po.orderedAt.getTime());
      } else {
        expect(received).toHaveLength(0);
      }
    }
    expect(data.purchaseOrders.some((po) => po.status === 'ordered')).toBe(true);
  });

  it('includes the demo scenarios: dead stock and low stock', () => {
    for (const def of PRODUCTS.filter((p) => p.deadForDays)) {
      const product = data.products.find((p) => p.sku === def.sku)!;
      const cutoff = NOW.getTime() - (def.deadForDays! - 1) * 86_400_000;
      const recentSales = data.sales.filter(
        (s) => s.soldAt.getTime() > cutoff && s.items.some((i) => i.product.equals(product._id)),
      );
      expect(recentSales).toHaveLength(0);
    }
    for (const def of PRODUCTS.filter((p) => p.lowStockDemo)) {
      const product = data.products.find((p) => p.sku === def.sku)!;
      expect(product.stock).toBeLessThanOrEqual(product.reorderLevel);
    }
  });

  it('uses valid GSTINs everywhere', () => {
    expect(isValidGstin(data.settings.gstin)).toBe(true);
    for (const s of data.suppliers) expect(isValidGstin(s.gstin)).toBe(true);
    for (const c of data.customers.filter((c) => c.gstin))
      expect(isValidGstin(c.gstin!)).toBe(true);
  });
});

describe('writeDataset', () => {
  useTestDatabase();

  it('stores a generated dataset that passes all schema validation', async () => {
    const small = generateDataset({ days: 45, seed: 11, now: NOW });
    await resetDatabase();
    await writeDataset(small);

    expect(await SaleModel.countDocuments()).toBe(small.sales.length);
    expect(await StockMovementModel.countDocuments()).toBe(small.stockMovements.length);
    expect(await CounterModel.countDocuments()).toBe(small.counters.length);

    // Stock in the products collection matches the ledger.
    const ledger = await StockMovementModel.aggregate<{ _id: unknown; total: number }>([
      { $group: { _id: '$product', total: { $sum: '$quantity' } } },
    ]);
    const products = await ProductModel.find().lean();
    for (const product of products) {
      const entry = ledger.find((l) => String(l._id) === String(product._id));
      expect(Math.round((entry?.total ?? 0) * 1000) / 1000).toBe(product.stock);
    }

    // Demo logins work.
    const admin = await UserModel.findOne({ email: 'admin@stocksmart.test' }).select(
      '+passwordHash',
    );
    expect(admin?.role).toBe('admin');
    expect(await verifyPassword('Admin@123', String(admin!.passwordHash))).toBe(true);
  });
});
