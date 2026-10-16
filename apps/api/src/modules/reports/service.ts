import {
  bucketLabel,
  bucketOf,
  calculateGst,
  getStateName,
  gstSetOff,
  istDateKey,
  marginPercent,
  PAYMENT_METHOD_LABELS,
  presetPeriod,
  previousPeriod,
  type DashboardDto,
  type DashboardQuery,
  type GstRate,
  type PeriodTotals,
  type ReportDto,
  type ReportQuery,
  type ReportRow,
  type ReportSection,
  type TaxHeads,
  type Unit,
} from '@ims/shared';
import type { Types } from 'mongoose';
import {
  CategoryModel,
  ProductModel,
  PurchaseOrderModel,
  SaleModel,
  SaleReturnModel,
  StockMovementModel,
  SupplierModel,
  UserModel,
} from '../../models/index.js';
import { toObjectId } from '../../utils/query.js';
import { inventorySummary } from '../inventory/service.js';
import { onOrderFor } from '../products/service.js';
import {
  dailyTotals,
  paymentTotals,
  periodRange,
  productTotals,
  sumPoints,
  type Period,
} from './aggregates.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (dateKey: string) => {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const periodLabel = (p: Period) =>
  p.from === p.to ? longDate(p.from) : `${longDate(p.from)} – ${longDate(p.to)}`;

function resolvePeriod(
  query: { from?: string; to?: string },
  fallback: Parameters<typeof presetPeriod>[0],
): Period {
  if (query.from && query.to) return { from: query.from, to: query.to };
  const preset = presetPeriod(fallback);
  if (query.from) return { from: query.from, to: query.from > preset.to ? query.from : preset.to };
  if (query.to) return { from: query.to < preset.from ? query.to : preset.from, to: query.to };
  return preset;
}

// ---------------------------------------------------------------------------
// Dashboard

/** The products at or below their reorder level, emptiest (relative to the level) first. */
async function needsRestock(limit: number) {
  const rows = await ProductModel.aggregate<{
    _id: Types.ObjectId;
    name: string;
    unit: Unit;
    stock: number;
    reorderLevel: number;
  }>([
    { $match: { isActive: true, $expr: { $lte: ['$stock', '$reorderLevel'] } } },
    {
      $addFields: {
        cover: {
          $cond: [{ $gt: ['$reorderLevel', 0] }, { $divide: ['$stock', '$reorderLevel'] }, 0],
        },
      },
    },
    { $sort: { cover: 1, name: 1 } },
    { $limit: limit },
    { $project: { name: 1, unit: 1, stock: 1, reorderLevel: 1 } },
  ]);
  const onOrder = await onOrderFor(rows.map((r) => r._id));
  return rows.map((r) => ({
    id: String(r._id),
    name: r.name,
    unit: r.unit,
    stock: r.stock,
    reorderLevel: r.reorderLevel,
    onOrder: onOrder.get(String(r._id)) ?? 0,
  }));
}

export async function getDashboard(query: DashboardQuery): Promise<DashboardDto> {
  const period = resolvePeriod(query, 'last30');
  const previous = previousPeriod(period.from, period.to);
  const [current, before, products, payments, stock, restock] = await Promise.all([
    dailyTotals(period),
    dailyTotals(previous),
    productTotals(period),
    paymentTotals(period),
    inventorySummary(),
    needsRestock(6),
  ]);
  return {
    period,
    previous,
    totals: current.totals,
    previousTotals: before.totals,
    daily: current.daily,
    topProducts: products
      .filter((p) => p.sales > 0)
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5)
      .map((p) => ({
        product: { id: String(p.product), name: p.name, unit: p.unit },
        quantity: Math.round((p.quantitySold - p.quantityReturned) * 1000) / 1000,
        sales: p.sales,
        profit: p.profit,
      })),
    payments,
    stock: {
      costValue: stock.costValue,
      retailValue: stock.retailValue,
      products: stock.products,
      lowStock: stock.lowStock,
      outOfStock: stock.outOfStock,
      needsRestock: restock,
    },
  };
}

// ---------------------------------------------------------------------------
// Reports

const money = (key: string, label: string) => ({ key, label, type: 'money' as const });
const num = (key: string, label: string) => ({ key, label, type: 'number' as const });
const pct = (key: string, label: string) => ({ key, label, type: 'percent' as const });
const text = (key: string, label: string) => ({ key, label, type: 'text' as const });
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const tradingColumns = [
  num('bills', 'Bills'),
  money('grossSales', 'Sales'),
  money('refunds', 'Refunds'),
  money('netSales', 'Net sales'),
  money('netTax', 'GST'),
  money('netTaxable', 'Taxable value'),
  money('costOfGoods', 'Cost of goods'),
  money('grossProfit', 'Gross profit'),
  pct('margin', 'Margin'),
];
const tradingRow = (t: PeriodTotals): ReportRow => ({
  bills: t.bills,
  grossSales: t.grossSales,
  refunds: t.refunds,
  netSales: t.netSales,
  netTax: t.netTax,
  netTaxable: t.netTaxable,
  costOfGoods: t.costOfGoods,
  grossProfit: t.grossProfit,
  margin: t.margin,
});

function report(
  kind: ReportDto['kind'],
  title: string,
  period: Period | undefined,
  highlights: ReportDto['highlights'],
  sections: ReportSection[],
): ReportDto {
  return {
    kind,
    title,
    subtitle: period ? periodLabel(period) : `As of ${longDate(istDateKey(new Date()))}`,
    ...(period && { period }),
    highlights,
    sections,
    generatedAt: new Date().toISOString(),
  };
}

async function salesReport(query: ReportQuery): Promise<ReportDto> {
  const period = resolvePeriod(query, 'thisMonth');
  const { start, end } = periodRange(period);
  const [{ daily, totals }, payments, cashiers] = await Promise.all([
    dailyTotals(period),
    paymentTotals(period),
    SaleModel.aggregate<{ _id: Types.ObjectId; bills: number; sales: number }>([
      { $match: { soldAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$cashier', bills: { $sum: 1 }, sales: { $sum: '$grandTotal' } } },
      { $sort: { sales: -1 } },
    ]),
  ]);

  const buckets = new Map<string, PeriodTotals[]>();
  for (const day of daily) {
    const key = bucketOf(day.date, query.groupBy);
    buckets.set(key, [...(buckets.get(key) ?? []), day]);
  }
  const names = new Map(
    (await UserModel.find({ _id: { $in: cashiers.map((c) => c._id) } }, { name: 1 }).lean()).map(
      (u) => [String(u._id), u.name],
    ),
  );
  const paid = payments.reduce((s, p) => s + p.amount, 0);

  return report(
    'sales',
    'Sales report',
    period,
    [
      { label: 'Net sales', value: totals.netSales, type: 'money' },
      { label: 'Gross profit', value: totals.grossProfit, type: 'money' },
      { label: 'Margin', value: totals.margin, type: 'percent' },
      { label: 'Bills', value: totals.bills, type: 'number' },
      { label: 'Average bill', value: totals.averageBill, type: 'money' },
    ],
    [
      {
        id: 'periods',
        title: { day: 'By day', week: 'By week', month: 'By month' }[query.groupBy],
        description:
          'Sales on the day they were billed; refunds on the day the credit note was issued. ' +
          'Gross profit is the taxable value less the cost of the goods when they were sold.',
        columns: [text('period', 'Period'), ...tradingColumns],
        rows: [...buckets.entries()].map(([key, points]) => ({
          bucket: key,
          period: bucketLabel(key, query.groupBy),
          ...tradingRow(sumPoints(points)),
        })),
        totals: { period: 'Total', ...tradingRow(totals) },
      },
      {
        id: 'payments',
        title: 'By payment method',
        description: 'A split bill counts once for each method it used.',
        columns: [
          text('method', 'Method'),
          num('bills', 'Bills'),
          money('amount', 'Amount'),
          pct('share', 'Share'),
        ],
        rows: payments.map((p) => ({
          method: PAYMENT_METHOD_LABELS[p.method],
          bills: p.bills,
          amount: p.amount,
          share: paid ? Math.round((p.amount / paid) * 1000) / 10 : null,
        })),
        totals: { method: 'Total', bills: null, amount: paid, share: paid ? 100 : null },
        empty: 'No sales in this period.',
      },
      {
        id: 'cashiers',
        title: 'By cashier',
        columns: [
          text('cashier', 'Cashier'),
          num('bills', 'Bills'),
          money('sales', 'Sales'),
          money('average', 'Average bill'),
        ],
        rows: cashiers.map((c) => ({
          cashier: names.get(String(c._id)) ?? 'Unknown',
          bills: c.bills,
          sales: c.sales,
          average: Math.round(c.sales / c.bills),
        })),
        empty: 'No sales in this period.',
      },
    ],
  );
}

async function productCategories(ids: Types.ObjectId[]) {
  const products = await ProductModel.find({ _id: { $in: ids } }, { category: 1 }).lean();
  const categories = await CategoryModel.find(
    { _id: { $in: [...new Set(products.map((p) => String(p.category)))] } },
    { name: 1 },
  ).lean();
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));
  return new Map(
    products.map((p) => [
      String(p._id),
      { id: String(p.category), name: categoryName.get(String(p.category)) ?? 'Uncategorised' },
    ]),
  );
}

async function productsReport(query: ReportQuery): Promise<ReportDto> {
  const period = resolvePeriod(query, 'thisMonth');
  const all = await productTotals(period);
  const categoryOf = await productCategories(all.map((p) => p.product));
  const uncategorised = { id: '', name: 'Removed product' };
  const rows = all
    .map((p) => ({ ...p, category: categoryOf.get(String(p.product)) ?? uncategorised }))
    .filter((p) => !query.category || p.category.id === query.category)
    .sort((a, b) =>
      query.sort === 'profit'
        ? b.profit - a.profit
        : query.sort === 'quantity'
          ? b.quantitySold - b.quantityReturned - (a.quantitySold - a.quantityReturned)
          : b.sales - a.sales,
    );

  const sum = (key: 'sales' | 'taxable' | 'cost' | 'profit') =>
    rows.reduce((s, r) => s + r[key], 0);
  const totalSales = sum('sales');
  const byCategory = new Map<
    string,
    { name: string; sales: number; taxable: number; profit: number; products: number }
  >();
  for (const r of rows) {
    const c = byCategory.get(r.category.name) ?? {
      name: r.category.name,
      sales: 0,
      taxable: 0,
      profit: 0,
      products: 0,
    };
    c.sales += r.sales;
    c.taxable += r.taxable;
    c.profit += r.profit;
    c.products += 1;
    byCategory.set(r.category.name, c);
  }
  const top = rows[0];

  return report(
    'products',
    'Product sales',
    period,
    [
      { label: 'Net sales', value: totalSales, type: 'money' },
      { label: 'Gross profit', value: sum('profit'), type: 'money' },
      { label: 'Margin', value: marginPercent(sum('profit'), sum('taxable')), type: 'percent' },
      {
        label: 'Products sold',
        value: rows.filter((r) => r.quantitySold > 0).length,
        type: 'number',
      },
      ...(top ? [{ label: 'Top product', value: top.name, type: 'text' as const }] : []),
    ],
    [
      {
        id: 'products',
        title: 'By product',
        description:
          'Quantities and amounts after returns in the same period. Line amounts, so the total can ' +
          'differ from the sales report by the bills’ round-off.',
        columns: [
          text('product', 'Product'),
          text('sku', 'SKU'),
          text('category', 'Category'),
          num('sold', 'Sold'),
          num('returned', 'Returned'),
          text('unit', 'Unit'),
          money('sales', 'Net sales'),
          money('taxable', 'Taxable value'),
          money('cost', 'Cost'),
          money('profit', 'Gross profit'),
          pct('margin', 'Margin'),
        ],
        rows: rows.map((r) => ({
          productId: String(r.product),
          product: r.name,
          sku: r.sku,
          category: r.category.name,
          sold: r.quantitySold,
          returned: r.quantityReturned,
          unit: r.unit,
          sales: r.sales,
          taxable: r.taxable,
          cost: r.cost,
          profit: r.profit,
          margin: marginPercent(r.profit, r.taxable),
        })),
        totals: {
          product: 'Total',
          sales: totalSales,
          taxable: sum('taxable'),
          cost: sum('cost'),
          profit: sum('profit'),
          margin: marginPercent(sum('profit'), sum('taxable')),
        },
        empty: 'Nothing sold in this period.',
      },
      {
        id: 'categories',
        title: 'By category',
        columns: [
          text('category', 'Category'),
          num('products', 'Products'),
          money('sales', 'Net sales'),
          pct('share', 'Share of sales'),
          money('profit', 'Gross profit'),
          pct('margin', 'Margin'),
        ],
        rows: [...byCategory.values()]
          .sort((a, b) => b.sales - a.sales)
          .map((c) => ({
            category: c.name,
            products: c.products,
            sales: c.sales,
            share: totalSales ? Math.round((c.sales / totalSales) * 1000) / 10 : null,
            profit: c.profit,
            margin: marginPercent(c.profit, c.taxable),
          })),
        empty: 'Nothing sold in this period.',
      },
    ],
  );
}

interface TaxLine {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}
const NO_TAX: TaxLine = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
const addTax = (a: TaxLine, b: Partial<TaxLine>, sign = 1): TaxLine => ({
  taxable: a.taxable + sign * (b.taxable ?? 0),
  cgst: a.cgst + sign * (b.cgst ?? 0),
  sgst: a.sgst + sign * (b.sgst ?? 0),
  igst: a.igst + sign * (b.igst ?? 0),
});
const taxRow = (t: TaxLine) => ({
  taxable: t.taxable,
  cgst: t.cgst,
  sgst: t.sgst,
  igst: t.igst,
  tax: t.cgst + t.sgst + t.igst,
});
const taxColumns = [
  money('taxable', 'Taxable value'),
  money('cgst', 'CGST'),
  money('sgst', 'SGST'),
  money('igst', 'IGST'),
  money('tax', 'Total tax'),
];

/** Input tax on goods received in the period, one row per delivery. */
async function inputTax(period: Period) {
  const { start, end } = periodRange(period);
  const orders = await PurchaseOrderModel.find(
    { 'receipts.receivedAt': { $gte: start, $lt: end } },
    { poNumber: 1, supplier: 1, interState: 1, items: 1, receipts: 1 },
  ).lean();
  const suppliers = new Map(
    (
      await SupplierModel.find(
        { _id: { $in: orders.map((o) => o.supplier) } },
        { name: 1, gstin: 1 },
      ).lean()
    ).map((s) => [String(s._id), s]),
  );
  const rows: (TaxLine & {
    receivedAt: Date;
    poNumber: string;
    supplier: string;
    gstin?: string;
    invoice?: string;
  })[] = [];
  for (const po of orders) {
    for (const receipt of po.receipts) {
      if (receipt.receivedAt < start || receipt.receivedAt >= end) continue;
      let tax = NO_TAX;
      for (const item of receipt.items) {
        const line = po.items.find((i) => String(i.product) === String(item.product));
        if (!line) continue;
        const taxable = Math.round(line.unitCost * item.quantity);
        tax = addTax(tax, calculateGst(taxable, line.gstRate as GstRate, po.interState));
      }
      const supplier = suppliers.get(String(po.supplier));
      rows.push({
        ...tax,
        receivedAt: receipt.receivedAt,
        poNumber: po.poNumber,
        supplier: supplier?.name ?? 'Unknown supplier',
        ...(supplier?.gstin && { gstin: supplier.gstin }),
        ...(receipt.supplierInvoiceNumber && { invoice: receipt.supplierInvoiceNumber }),
      });
    }
  }
  return rows.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

async function gstReport(query: ReportQuery): Promise<ReportDto> {
  const period = resolvePeriod(query, 'lastMonth');
  const { start, end } = periodRange(period);
  const inPeriod = (field: string) => ({ [field]: { $gte: start, $lt: end } });
  const sold = { ...inPeriod('soldAt'), status: { $ne: 'cancelled' as const } };

  type RateRow = TaxLine & { _id: { rate: number; b2b: boolean } };
  type HsnRow = TaxLine & { _id: { hsn: string; rate: number; unit: string }; quantity: number };
  const itemTax = {
    taxable: { $sum: '$items.taxable' },
    cgst: { $sum: '$items.cgst' },
    sgst: { $sum: '$items.sgst' },
    igst: { $sum: '$items.igst' },
  };
  const [salesByRate, returnsByRate, salesHsn, returnsHsn, b2b, creditNotes, itc] =
    await Promise.all([
      SaleModel.aggregate<RateRow>([
        { $match: sold },
        { $unwind: '$items' },
        {
          $group: {
            _id: {
              rate: '$items.gstRate',
              b2b: { $gt: [{ $strLenCP: { $ifNull: ['$customerSnapshot.gstin', ''] } }, 0] },
            },
            ...itemTax,
          },
        },
      ]),
      SaleReturnModel.aggregate<RateRow>([
        { $match: inPeriod('returnedAt') },
        {
          $lookup: {
            from: 'sales',
            localField: 'sale',
            foreignField: '_id',
            pipeline: [{ $project: { gstin: '$customerSnapshot.gstin' } }],
            as: 'invoice',
          },
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: {
              rate: '$items.gstRate',
              b2b: {
                $gt: [
                  {
                    $strLenCP: {
                      $ifNull: [{ $arrayElemAt: ['$invoice.gstin', 0] }, ''],
                    },
                  },
                  0,
                ],
              },
            },
            ...itemTax,
          },
        },
      ]),
      SaleModel.aggregate<HsnRow>([
        { $match: sold },
        { $unwind: '$items' },
        {
          $group: {
            _id: { hsn: '$items.hsnCode', rate: '$items.gstRate', unit: '$items.unit' },
            quantity: { $sum: '$items.quantity' },
            ...itemTax,
          },
        },
      ]),
      SaleReturnModel.aggregate<HsnRow>([
        { $match: inPeriod('returnedAt') },
        { $unwind: '$items' },
        {
          $group: {
            _id: { hsn: '$items.hsnCode', rate: '$items.gstRate', unit: '$items.unit' },
            quantity: { $sum: '$items.quantity' },
            ...itemTax,
          },
        },
      ]),
      SaleModel.find(
        { ...sold, 'customerSnapshot.gstin': { $type: 'string', $ne: '' } },
        {
          invoiceNumber: 1,
          soldAt: 1,
          customerSnapshot: 1,
          placeOfSupply: 1,
          taxable: 1,
          totalTax: 1,
          grandTotal: 1,
        },
      )
        .sort({ soldAt: 1 })
        .lean(),
      SaleReturnModel.find(inPeriod('returnedAt'), {
        returnNumber: 1,
        returnedAt: 1,
        invoiceNumber: 1,
        customerName: 1,
        taxable: 1,
        cgst: 1,
        sgst: 1,
        igst: 1,
        totalRefund: 1,
      })
        .sort({ returnedAt: 1 })
        .lean(),
      inputTax(period),
    ]);

  // Output tax by rate and type, net of credit notes.
  const rates = new Map<string, TaxLine & { rate: number; b2b: boolean }>();
  for (const [rows, sign] of [
    [salesByRate, 1],
    [returnsByRate, -1],
  ] as const) {
    for (const r of rows) {
      const key = `${r._id.rate}|${r._id.b2b}`;
      const current = rates.get(key) ?? { ...NO_TAX, rate: r._id.rate, b2b: r._id.b2b };
      rates.set(key, { ...addTax(current, r, sign), rate: r._id.rate, b2b: r._id.b2b });
    }
  }
  const outward = salesByRate.reduce((t, r) => addTax(t, r), NO_TAX);
  const credited = returnsByRate.reduce((t, r) => addTax(t, r), NO_TAX);
  const netOutward = addTax(outward, credited, -1);
  const credit = itc.reduce((t, r) => addTax(t, r), NO_TAX);
  const { payable, carriedForward } = gstSetOff(netOutward, credit);
  const heads = (h: TaxHeads) => ({ ...h, tax: h.cgst + h.sgst + h.igst });

  const hsn = new Map<
    string,
    TaxLine & { hsn: string; rate: number; unit: string; quantity: number }
  >();
  for (const [rows, sign] of [
    [salesHsn, 1],
    [returnsHsn, -1],
  ] as const) {
    for (const r of rows) {
      const key = `${r._id.hsn}|${r._id.rate}|${r._id.unit}`;
      const current = hsn.get(key) ?? { ...NO_TAX, ...r._id, quantity: 0 };
      hsn.set(key, {
        ...current,
        ...addTax(current, r, sign),
        quantity: current.quantity + sign * r.quantity,
      });
    }
  }
  const dateOf = (d: Date) => longDate(istDateKey(d));
  const tax = (t: TaxLine) => t.cgst + t.sgst + t.igst;

  return report(
    'gst',
    'GST summary',
    period,
    [
      { label: 'Output tax', value: tax(netOutward), type: 'money' },
      { label: 'Input tax credit', value: tax(credit), type: 'money' },
      { label: 'GST payable in cash', value: tax({ ...payable, taxable: 0 }), type: 'money' },
      {
        label: 'Credit carried forward',
        value: tax({ ...carriedForward, taxable: 0 }),
        type: 'money',
      },
      { label: 'Taxable sales', value: netOutward.taxable, type: 'money' },
    ],
    [
      {
        id: 'summary',
        title: 'Tax liability',
        description:
          'To help prepare GSTR-1 and GSTR-3B. Input tax credit is from goods received in the ' +
          'period, set off in the order the GST rules require (IGST credit first). Check with ' +
          'your accountant before filing.',
        columns: [text('head', 'Head'), ...taxColumns],
        rows: [
          { head: 'Outward supplies (invoices)', ...taxRow(outward) },
          { head: 'Less: credit notes', ...taxRow(credited) },
          { head: 'Net outward supplies', ...taxRow(netOutward) },
          { head: 'Input tax credit (purchases)', ...taxRow(credit) },
          { head: 'Credit carried forward', taxable: null, ...heads(carriedForward) },
        ],
        totals: { head: 'GST payable in cash', taxable: null, ...heads(payable) },
      },
      {
        id: 'rates',
        title: 'Outward supplies by rate',
        description: 'B2B: invoices to customers with a GSTIN. After credit notes.',
        columns: [pct('rate', 'GST rate'), text('type', 'Type'), ...taxColumns],
        rows: [...rates.values()]
          .sort((a, b) => a.rate - b.rate || Number(b.b2b) - Number(a.b2b))
          .map((r) => ({ rate: r.rate, type: r.b2b ? 'B2B' : 'B2C', ...taxRow(r) })),
        totals: { rate: null, type: 'Total', ...taxRow(netOutward) },
        empty: 'No sales in this period.',
      },
      {
        id: 'hsn',
        title: 'HSN summary',
        description: 'As in GSTR-1 table 12, after credit notes.',
        columns: [
          text('hsn', 'HSN'),
          pct('rate', 'GST rate'),
          text('unit', 'Unit'),
          num('quantity', 'Quantity'),
          ...taxColumns,
        ],
        rows: [...hsn.values()]
          .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
          .map((h) => ({
            hsn: h.hsn,
            rate: h.rate,
            unit: h.unit,
            quantity: round3(h.quantity),
            ...taxRow(h),
          })),
        empty: 'No sales in this period.',
      },
      {
        id: 'b2b',
        title: 'B2B invoices',
        description: 'Invoices to registered customers, for GSTR-1 table 4.',
        columns: [
          text('invoice', 'Invoice'),
          text('date', 'Date'),
          text('customer', 'Customer'),
          text('gstin', 'GSTIN'),
          text('placeOfSupply', 'Place of supply'),
          money('taxable', 'Taxable value'),
          money('tax', 'Tax'),
          money('total', 'Invoice value'),
        ],
        rows: b2b.map((s) => ({
          invoice: s.invoiceNumber,
          date: dateOf(s.soldAt),
          customer: s.customerSnapshot?.name ?? '',
          gstin: s.customerSnapshot?.gstin ?? '',
          placeOfSupply: `${s.placeOfSupply}-${getStateName(s.placeOfSupply) ?? ''}`,
          taxable: s.taxable,
          tax: s.totalTax,
          total: s.grandTotal,
        })),
        totals: {
          invoice: `${b2b.length} invoices`,
          taxable: b2b.reduce((t, s) => t + s.taxable, 0),
          tax: b2b.reduce((t, s) => t + s.totalTax, 0),
          total: b2b.reduce((t, s) => t + s.grandTotal, 0),
        },
        empty: 'No invoices to registered customers in this period.',
      },
      {
        id: 'credit-notes',
        title: 'Credit notes',
        columns: [
          text('number', 'Credit note'),
          text('date', 'Date'),
          text('invoice', 'Against invoice'),
          text('customer', 'Customer'),
          money('taxable', 'Taxable value'),
          money('tax', 'Tax'),
          money('refund', 'Refund'),
        ],
        rows: creditNotes.map((r) => ({
          number: r.returnNumber,
          date: dateOf(r.returnedAt),
          invoice: r.invoiceNumber,
          customer: r.customerName ?? 'Walk-in customer',
          taxable: r.taxable,
          tax: r.cgst + r.sgst + r.igst,
          refund: r.totalRefund,
        })),
        totals: {
          number: `${creditNotes.length} credit notes`,
          taxable: credited.taxable,
          tax: tax(credited),
          refund: creditNotes.reduce((t, r) => t + r.totalRefund, 0),
        },
        empty: 'No credit notes in this period.',
      },
      {
        id: 'itc',
        title: 'Input tax credit',
        description: 'Tax paid on goods received from suppliers in the period.',
        columns: [
          text('date', 'Received'),
          text('po', 'Purchase order'),
          text('supplier', 'Supplier'),
          text('gstin', 'GSTIN'),
          text('invoice', 'Supplier invoice'),
          ...taxColumns,
        ],
        rows: itc.map((r) => ({
          date: dateOf(r.receivedAt),
          po: r.poNumber,
          supplier: r.supplier,
          gstin: r.gstin ?? '',
          invoice: r.invoice ?? '',
          ...taxRow(r),
        })),
        totals: { date: 'Total', ...taxRow(credit) },
        empty: 'No goods received in this period.',
      },
    ],
  );
}

const DEAD_AFTER_DAYS = 60;
const STATUS_LABELS = {
  out: 'Out of stock',
  low: 'Low',
  dead: `No sales in ${DEAD_AFTER_DAYS} days`,
  ok: 'OK',
};

async function stockReport(query: ReportQuery): Promise<ReportDto> {
  const now = Date.now();
  const since30 = new Date(now - 30 * 86_400_000);
  const [products, movements, summary] = await Promise.all([
    ProductModel.find(
      { isActive: true, ...(query.category && { category: toObjectId(query.category) }) },
      {
        name: 1,
        sku: 1,
        category: 1,
        unit: 1,
        stock: 1,
        costPrice: 1,
        sellingPrice: 1,
        reorderLevel: 1,
      },
    )
      .collation({ locale: 'en' })
      .sort({ name: 1 })
      .lean(),
    StockMovementModel.aggregate<{ _id: Types.ObjectId; lastSold: Date; sold30: number }>([
      { $match: { type: 'sale' } },
      {
        $group: {
          _id: '$product',
          lastSold: { $max: '$occurredAt' },
          sold30: {
            $sum: { $cond: [{ $gte: ['$occurredAt', since30] }, { $abs: '$quantity' }, 0] },
          },
        },
      },
    ]),
    inventorySummary(),
  ]);
  const sales = new Map(movements.map((m) => [String(m._id), m]));
  const categories = new Map(
    (await CategoryModel.find({}, { name: 1 }).lean()).map((c) => [String(c._id), c.name]),
  );

  const rows = products.map((p) => {
    const s = sales.get(String(p._id));
    const sold30 = round3(s?.sold30 ?? 0);
    const idleDays = s ? (now - s.lastSold.getTime()) / 86_400_000 : Infinity;
    const status: keyof typeof STATUS_LABELS =
      p.stock <= 0
        ? 'out'
        : p.stock <= p.reorderLevel
          ? 'low'
          : idleDays > DEAD_AFTER_DAYS
            ? 'dead'
            : 'ok';
    return {
      productId: String(p._id),
      product: p.name,
      sku: p.sku,
      category: categories.get(String(p.category)) ?? 'Uncategorised',
      status,
      statusLabel: STATUS_LABELS[status],
      stock: p.stock,
      unit: p.unit,
      costPrice: p.costPrice,
      costValue: Math.round(p.stock * p.costPrice),
      retailValue: Math.round(p.stock * p.sellingPrice),
      sold30,
      // How long the stock lasts at the last 30 days' pace.
      cover: sold30 > 0 ? Math.round(p.stock / (sold30 / 30)) : null,
      lastSold: s ? longDate(istDateKey(s.lastSold)) : 'Never',
    };
  });
  const shown = rows
    .filter((r) => query.stock === 'all' || r.status === query.stock)
    .sort((a, b) => b.costValue - a.costValue);
  const deadValue = rows.filter((r) => r.status === 'dead').reduce((t, r) => t + r.costValue, 0);

  return report(
    'stock',
    'Stock report',
    undefined,
    [
      { label: 'Stock value (cost)', value: summary.costValue, type: 'money' },
      { label: 'Stock value (selling price)', value: summary.retailValue, type: 'money' },
      { label: 'Low stock', value: summary.lowStock, type: 'number' },
      { label: 'Out of stock', value: summary.outOfStock, type: 'number' },
      { label: `Not sold in ${DEAD_AFTER_DAYS} days (cost)`, value: deadValue, type: 'money' },
    ],
    [
      {
        id: 'stock',
        title: 'By product',
        description:
          'Valued at cost price (weighted average) and at selling price. Cover is how many days ' +
          'the stock lasts at the last 30 days’ sales.',
        columns: [
          text('product', 'Product'),
          text('sku', 'SKU'),
          text('category', 'Category'),
          text('statusLabel', 'Status'),
          num('stock', 'In stock'),
          text('unit', 'Unit'),
          money('costPrice', 'Cost price'),
          money('costValue', 'Stock value'),
          money('retailValue', 'At selling price'),
          num('sold30', 'Sold (30 days)'),
          num('cover', 'Cover (days)'),
          text('lastSold', 'Last sold'),
        ],
        rows: shown,
        totals: {
          product: `${shown.length} products`,
          costValue: shown.reduce((t, r) => t + r.costValue, 0),
          retailValue: shown.reduce((t, r) => t + r.retailValue, 0),
        },
        empty: 'No products match.',
      },
      {
        id: 'categories',
        title: 'By category',
        columns: [
          text('category', 'Category'),
          num('products', 'Products'),
          money('costValue', 'Stock value'),
          money('retailValue', 'At selling price'),
          num('lowStock', 'Low'),
          num('outOfStock', 'Out'),
        ],
        rows: summary.byCategory.map((c) => ({
          category: c.category.name,
          products: c.products,
          costValue: c.costValue,
          retailValue: c.retailValue,
          lowStock: c.lowStock,
          outOfStock: c.outOfStock,
        })),
        totals: {
          category: 'Total',
          products: summary.products,
          costValue: summary.costValue,
          retailValue: summary.retailValue,
          lowStock: summary.lowStock,
          outOfStock: summary.outOfStock,
        },
      },
    ],
  );
}

export function getReport(kind: ReportDto['kind'], query: ReportQuery): Promise<ReportDto> {
  switch (kind) {
    case 'sales':
      return salesReport(query);
    case 'products':
      return productsReport(query);
    case 'gst':
      return gstReport(query);
    case 'stock':
      return stockReport(query);
  }
}
