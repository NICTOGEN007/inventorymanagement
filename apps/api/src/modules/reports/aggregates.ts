import {
  BUSINESS_TIME_ZONE,
  daysOf,
  istDayRange,
  marginPercent,
  type DailyPoint,
  type PaymentMethod,
  type PeriodTotals,
  type Unit,
} from '@ims/shared';
import type { Types } from 'mongoose';
import { SaleModel, SaleReturnModel } from '../../models/index.js';

/**
 * The sums every report is built from. Sales count on the day they were billed and returns on
 * the day the credit note was issued, as GST returns do. Profit is the taxable value less the
 * cost of the goods when they were sold; goods that went back on the shelf come off the cost,
 * damaged ones taken back stay in it (the shop has lost them).
 */

export interface Period {
  from: string;
  to: string;
}

/** The UTC instants of an IST period: from the start of `from` to the end of `to`. */
export function periodRange({ from, to }: Period) {
  return { start: istDayRange(from).start, end: istDayRange(to).end };
}

const dayOf = (field: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: BUSINESS_TIME_ZONE },
});
const lineCost = { $multiply: ['$$i.unitCost', '$$i.quantity'] };

interface Parts {
  bills: number;
  grossSales: number;
  taxable: number;
  tax: number;
  cost: number;
  returns: number;
  refunds: number;
  returnedTaxable: number;
  returnedTax: number;
  costBack: number;
}

const NO_PARTS: Parts = {
  bills: 0,
  grossSales: 0,
  taxable: 0,
  tax: 0,
  cost: 0,
  returns: 0,
  refunds: 0,
  returnedTaxable: 0,
  returnedTax: 0,
  costBack: 0,
};

function toTotals(p: Parts): PeriodTotals {
  const netSales = p.grossSales - p.refunds;
  const netTaxable = p.taxable - p.returnedTaxable;
  const costOfGoods = Math.round(p.cost - p.costBack);
  const grossProfit = netTaxable - costOfGoods;
  return {
    bills: p.bills,
    grossSales: p.grossSales,
    refunds: p.refunds,
    returns: p.returns,
    netSales,
    netTaxable,
    netTax: p.tax - p.returnedTax,
    costOfGoods,
    grossProfit,
    margin: marginPercent(grossProfit, netTaxable),
    averageBill: p.bills ? Math.round(netSales / p.bills) : 0,
  };
}

const add = (a: Parts, b: Partial<Parts>): Parts => {
  const out = { ...a };
  for (const key of Object.keys(NO_PARTS) as (keyof Parts)[]) out[key] += b[key] ?? 0;
  return out;
};

/** One point per IST day in the period (days with no trade included), plus the period total. */
export async function dailyTotals(period: Period): Promise<{
  daily: DailyPoint[];
  totals: PeriodTotals;
}> {
  const { start, end } = periodRange(period);
  const [sales, returns] = await Promise.all([
    SaleModel.aggregate<Partial<Parts> & { _id: string }>([
      { $match: { soldAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: dayOf('$soldAt'),
          bills: { $sum: 1 },
          grossSales: { $sum: '$grandTotal' },
          taxable: { $sum: '$taxable' },
          tax: { $sum: '$totalTax' },
          cost: { $sum: { $sum: { $map: { input: '$items', as: 'i', in: lineCost } } } },
        },
      },
    ]),
    SaleReturnModel.aggregate<Partial<Parts> & { _id: string }>([
      { $match: { returnedAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: dayOf('$returnedAt'),
          returns: { $sum: 1 },
          refunds: { $sum: '$totalRefund' },
          returnedTaxable: { $sum: '$taxable' },
          returnedTax: { $sum: { $add: ['$cgst', '$sgst', '$igst'] } },
          costBack: {
            $sum: {
              $sum: {
                $map: {
                  input: {
                    $filter: { input: '$items', as: 'i', cond: { $ne: ['$$i.restock', false] } },
                  },
                  as: 'i',
                  in: lineCost,
                },
              },
            },
          },
        },
      },
    ]),
  ]);

  const byDay = new Map<string, Parts>();
  for (const row of [...sales, ...returns]) {
    byDay.set(row._id, add(byDay.get(row._id) ?? NO_PARTS, row));
  }
  let all = NO_PARTS;
  const daily = daysOf(period.from, period.to).map((date) => {
    const parts = byDay.get(date) ?? NO_PARTS;
    all = add(all, parts);
    return { date, ...toTotals(parts) };
  });
  return { daily, totals: toTotals(all) };
}

/** Adds up daily points (e.g. into weeks or months) the same way a period is added up. */
export function sumPoints(points: readonly PeriodTotals[]): PeriodTotals {
  const bills = points.reduce((s, p) => s + p.bills, 0);
  const sum = (
    key: 'grossSales' | 'refunds' | 'returns' | 'netTaxable' | 'netTax' | 'costOfGoods',
  ) => points.reduce((s, p) => s + p[key], 0);
  const netSales = sum('grossSales') - sum('refunds');
  const grossProfit = sum('netTaxable') - sum('costOfGoods');
  return {
    bills,
    grossSales: sum('grossSales'),
    refunds: sum('refunds'),
    returns: sum('returns'),
    netSales,
    netTaxable: sum('netTaxable'),
    netTax: sum('netTax'),
    costOfGoods: sum('costOfGoods'),
    grossProfit,
    margin: marginPercent(grossProfit, sum('netTaxable')),
    averageBill: bills ? Math.round(netSales / bills) : 0,
  };
}

export interface ProductTotals {
  product: Types.ObjectId;
  name: string;
  sku: string;
  unit: Unit;
  quantitySold: number;
  quantityReturned: number;
  /** Incl. GST, after returns. */
  sales: number;
  taxable: number;
  cost: number;
  profit: number;
}

/** Per product: what sold and came back in the period, with profit. */
export async function productTotals(period: Period): Promise<ProductTotals[]> {
  const { start, end } = periodRange(period);
  const [sold, returned] = await Promise.all([
    SaleModel.aggregate<{
      _id: Types.ObjectId;
      name: string;
      sku: string;
      unit: Unit;
      quantity: number;
      sales: number;
      taxable: number;
      cost: number;
    }>([
      { $match: { soldAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $last: '$items.name' },
          sku: { $last: '$items.sku' },
          unit: { $last: '$items.unit' },
          quantity: { $sum: '$items.quantity' },
          sales: { $sum: '$items.total' },
          taxable: { $sum: '$items.taxable' },
          cost: { $sum: { $multiply: ['$items.unitCost', '$items.quantity'] } },
        },
      },
    ]),
    SaleReturnModel.aggregate<{
      _id: Types.ObjectId;
      name: string;
      sku: string;
      unit: Unit;
      quantity: number;
      refunds: number;
      taxable: number;
      costBack: number;
    }>([
      { $match: { returnedAt: { $gte: start, $lt: end } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $last: '$items.name' },
          sku: { $last: '$items.sku' },
          unit: { $last: '$items.unit' },
          quantity: { $sum: '$items.quantity' },
          refunds: { $sum: '$items.total' },
          taxable: { $sum: '$items.taxable' },
          costBack: {
            $sum: {
              $cond: [
                { $ne: ['$items.restock', false] },
                { $multiply: ['$items.unitCost', '$items.quantity'] },
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const rows = new Map<string, ProductTotals>();
  for (const s of sold) {
    rows.set(String(s._id), {
      product: s._id,
      name: s.name,
      sku: s.sku,
      unit: s.unit,
      quantitySold: s.quantity,
      quantityReturned: 0,
      sales: s.sales,
      taxable: s.taxable,
      cost: s.cost,
      profit: 0,
    });
  }
  for (const r of returned) {
    const row = rows.get(String(r._id)) ?? {
      product: r._id,
      name: r.name,
      sku: r.sku,
      unit: r.unit,
      quantitySold: 0,
      quantityReturned: 0,
      sales: 0,
      taxable: 0,
      cost: 0,
      profit: 0,
    };
    row.quantityReturned += r.quantity;
    row.sales -= r.refunds;
    row.taxable -= r.taxable;
    row.cost -= r.costBack;
    rows.set(String(r._id), row);
  }
  return [...rows.values()].map((r) => {
    const cost = Math.round(r.cost);
    return {
      ...r,
      quantitySold: Math.round(r.quantitySold * 1000) / 1000,
      quantityReturned: Math.round(r.quantityReturned * 1000) / 1000,
      cost,
      profit: r.taxable - cost,
    };
  });
}

/** How customers paid in the period (bills that used each method, and the amount). */
export async function paymentTotals(
  period: Period,
): Promise<{ method: PaymentMethod; bills: number; amount: number }[]> {
  const { start, end } = periodRange(period);
  const rows = await SaleModel.aggregate<{ _id: PaymentMethod; bills: number; amount: number }>([
    { $match: { soldAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } } },
    { $unwind: '$payments' },
    {
      $group: { _id: '$payments.method', bills: { $sum: 1 }, amount: { $sum: '$payments.amount' } },
    },
    { $sort: { amount: -1 } },
  ]);
  return rows.map((r) => ({ method: r._id, bills: r.bills, amount: r.amount }));
}
