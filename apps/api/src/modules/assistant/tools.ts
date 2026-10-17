import {
  can,
  istDateKey,
  presetPeriod,
  reportQuerySchema,
  rupeesToPaise,
  type ReportDto,
  type RestockPlanDto,
  type Role,
} from '@ims/shared';
import { ProductModel, RestockPlanModel, SupplierModel } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { containsPattern } from '../../utils/query.js';
import { getForecastOverview, getProductForecast } from '../forecasting/service.js';
import { productTotals } from '../reports/aggregates.js';
import { getDashboard, getReport } from '../reports/service.js';
import { createRestockPlan, getRestockPlan, updateRestockPlan } from '../restock/service.js';
import type { ToolSchema, ToolSpec } from './provider.js';

/**
 * What the assistant can do: read the shop's figures through the same services as the screens,
 * and prepare or edit a draft restock plan. There is deliberately no tool to confirm a plan or
 * place an order; only a person can do that, from the plan page.
 */

export interface ToolContext {
  user: { id: string; role: Role };
  /** Set when a tool prepares or edits a plan, so the chat can show it. */
  plan?: RestockPlanDto;
}

/** Money for the model in rupees, rounded to paise. */
const inr = (paise: number) => Math.round(paise) / 100;

const PERIODS = ['today', 'last7', 'last30', 'thisMonth', 'lastMonth', 'thisFy'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const periodParams: Record<string, ToolSchema> = {
  period: {
    type: 'string',
    enum: [...PERIODS],
    description: 'A preset period. Use from/to instead for other dates.',
  },
  from: { type: 'string', description: 'First day, YYYY-MM-DD (IST).' },
  to: { type: 'string', description: 'Last day, YYYY-MM-DD (IST), inclusive.' },
};

function periodOf(args: Record<string, unknown>, fallback: (typeof PERIODS)[number]) {
  if (typeof args.from === 'string' && DATE.test(args.from)) {
    const to = typeof args.to === 'string' && DATE.test(args.to) ? args.to : istDateKey(new Date());
    return { from: args.from, to };
  }
  const preset = PERIODS.find((p) => p === args.period) ?? fallback;
  return presetPeriod(preset);
}

const highlights = (r: ReportDto) =>
  Object.fromEntries(
    r.highlights.map((h) => [
      h.label,
      h.type === 'money' && typeof h.value === 'number' ? `₹${inr(h.value)}` : h.value,
    ]),
  );

async function findProduct(name: string) {
  const pattern = containsPattern(name);
  const matches = await ProductModel.find(
    { isActive: true, $or: [{ name: pattern }, { sku: pattern }] },
    { name: 1, sku: 1 },
  )
    .limit(5)
    .lean();
  const exact = matches.find((m) => m.name.toLowerCase() === name.trim().toLowerCase());
  if (exact || matches.length === 1) return exact ?? matches[0]!;
  if (matches.length === 0) throw AppError.notFound(`No product matches "${name}"`);
  throw AppError.badRequest(
    `"${name}" matches several products: ${matches.map((m) => m.name).join(', ')}. Ask which one.`,
  );
}

function planSummary(plan: RestockPlanDto) {
  return {
    planNumber: plan.planNumber,
    status: plan.status,
    total_inr: inr(plan.total),
    ...(plan.budget !== undefined && { budget_inr: inr(plan.budget) }),
    suppliers: plan.groups.map((g) => ({
      supplier: g.supplier.name,
      deliversInDays: g.supplier.leadTimeDays,
      total_inr: inr(g.total),
      items: g.items.map((i) => ({
        product: i.product.name,
        quantity: i.quantity,
        unit: i.product.unit,
        suggested: i.suggestedQuantity,
        cost_inr: inr(i.total),
        why: i.reasons.join('; '),
      })),
    })),
    notIncluded: plan.skipped.map((s) => `${s.product.name}: ${s.reason}`),
    note: 'This is a draft. Nothing is ordered until the owner presses "Confirm & place orders" on the plan.',
  };
}

function requireManage(ctx: ToolContext) {
  if (!can(ctx.user.role, 'purchases:manage')) {
    throw AppError.forbidden('Only someone who can manage purchases can prepare restock plans');
  }
}

interface Tool extends ToolSpec {
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>>;
}

export const TOOLS: Tool[] = [
  {
    name: 'get_sales_summary',
    description:
      'Net sales, gross profit, bills, average bill, refunds and GST for a period, compared with the period of the same length before it; also the top 5 products and how customers paid.',
    parameters: { type: 'object', properties: { ...periodParams } },
    async run(args) {
      const d = await getDashboard(periodOf(args, 'last30'));
      const totals = (t: typeof d.totals) => ({
        netSales_inr: inr(t.netSales),
        grossProfit_inr: inr(t.grossProfit),
        marginPercent: t.margin,
        bills: t.bills,
        averageBill_inr: inr(t.averageBill),
        refunds_inr: inr(t.refunds),
        returns: t.returns,
        gstCollected_inr: inr(t.netTax),
      });
      return {
        period: d.period,
        totals: totals(d.totals),
        previousPeriod: { ...d.previous, totals: totals(d.previousTotals) },
        topProducts: d.topProducts.map((p) => ({
          product: p.product.name,
          quantity: p.quantity,
          sales_inr: inr(p.sales),
          profit_inr: inr(p.profit),
        })),
        payments: d.payments.map((p) => ({
          method: p.method,
          bills: p.bills,
          amount_inr: inr(p.amount),
        })),
      };
    },
  },
  {
    name: 'get_product_sales',
    description:
      'Sales by product for a period: quantity sold and returned, sales and gross profit. Use for "what sold most", "least profitable" and similar questions.',
    parameters: {
      type: 'object',
      properties: {
        ...periodParams,
        sort: {
          type: 'string',
          enum: ['sales', 'profit', 'quantity'],
          description: 'Default sales.',
        },
        order: { type: 'string', enum: ['top', 'bottom'], description: 'Default top.' },
        limit: { type: 'integer', description: 'How many products, 1 to 20 (default 10).' },
      },
    },
    async run(args) {
      const period = periodOf(args, 'last30');
      const rows = await productTotals(period);
      const key =
        args.sort === 'profit' ? 'profit' : args.sort === 'quantity' ? 'quantity' : 'sales';
      const value = (r: (typeof rows)[number]) =>
        key === 'quantity' ? r.quantitySold - r.quantityReturned : r[key];
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
      const sorted = rows.sort((a, b) => value(b) - value(a));
      const picked =
        args.order === 'bottom' ? sorted.slice(-limit).reverse() : sorted.slice(0, limit);
      return {
        period,
        products: picked.map((r) => ({
          product: r.name,
          unit: r.unit,
          quantitySold: Math.round((r.quantitySold - r.quantityReturned) * 1000) / 1000,
          sales_inr: inr(r.sales),
          grossProfit_inr: inr(r.profit),
        })),
      };
    },
  },
  {
    name: 'get_restock_status',
    description:
      'Demand forecasts for every product: what to reorder now, what to order soon, what is already on order and what is not selling (dead stock), with expected daily sales, days the stock lasts, the suggested order and the reasons.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['reorder', 'watch', 'ordered', 'ok', 'dead', 'all'],
          description:
            'reorder = order now, watch = order within 3 days, ordered = covered by goods on order, dead = not selling. Default: reorder and watch.',
        },
      },
    },
    async run(args) {
      const overview = await getForecastOverview();
      const wanted =
        args.status === 'all'
          ? null
          : typeof args.status === 'string'
            ? [args.status]
            : ['reorder', 'watch'];
      return {
        basedOnSalesUpTo: overview.asOf,
        counts: overview.counts,
        products: overview.items
          .filter((i) => !wanted || wanted.includes(i.status))
          .slice(0, 40)
          .map((i) => ({
            product: i.product.name,
            status: i.status,
            stock: i.stock,
            onOrder: i.onOrder,
            unit: i.product.unit,
            expectedDailySales: i.dailyDemand,
            daysUntilStockout: i.daysUntilStockout ?? 'more than 120',
            suggestedOrder: i.suggestedQuantity,
            supplier: i.supplier?.name ?? 'none set',
            why: i.reasons.join('; '),
          })),
      };
    },
  },
  {
    name: 'get_product_forecast',
    description:
      'One product in detail: stock, forecast for the next 14 days, reorder point, safety stock, weekly pattern, festival lifts and forecast accuracy.',
    parameters: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'Product name or SKU, e.g. "sunflower oil".' },
      },
      required: ['product'],
    },
    async run(args) {
      const product = await findProduct(String(args.product ?? ''));
      const f = await getProductForecast(String(product._id));
      return {
        product: f.item.product.name,
        status: f.item.status,
        stock: f.item.stock,
        onOrder: f.item.onOrder,
        unit: f.item.product.unit,
        expectedDailySales: f.item.dailyDemand,
        daysUntilStockout: f.item.daysUntilStockout ?? 'more than 120',
        reorderPoint: f.item.reorderPoint,
        safetyStock: f.item.safetyStock,
        suggestedOrder: f.item.suggestedQuantity,
        supplier: f.item.supplier ?? 'none set',
        why: f.item.reasons,
        next14Days: f.forecast.slice(0, 14).map((d) => ({
          date: d.date,
          expected: d.expected,
          likelyRange: [d.low, d.high],
          ...(d.festival && { festival: d.festival }),
        })),
        method: f.model.method,
        weeklyPatternSundayFirst: f.model.season,
        festivalLift: f.model.festivalUplift,
        ...(f.backtest && {
          accuracyLastWeeks: {
            weeklyErrorPercent: f.backtest.mape,
            movingAverageErrorPercent: f.backtest.baselineMape,
          },
        }),
      };
    },
  },
  {
    name: 'get_gst_summary',
    description:
      'GST for a period: output tax, credit notes, input tax credit and the tax payable after set-off (CGST, SGST, IGST). Default: last month.',
    parameters: { type: 'object', properties: { ...periodParams } },
    async run(args) {
      const report = await getReport('gst', reportQuerySchema.parse(periodOf(args, 'lastMonth')));
      return { period: report.period, figures: highlights(report) };
    },
  },
  {
    name: 'get_stock_value',
    description:
      'What the stock on the shelf is worth now at cost and at selling price, and how many products are low, out or not selling.',
    parameters: { type: 'object', properties: {} },
    async run() {
      const report = await getReport('stock', reportQuerySchema.parse({}));
      return { asOf: istDateKey(new Date()), figures: highlights(report) };
    },
  },
  {
    name: 'create_restock_plan',
    description:
      'Prepare a draft restock plan from the demand forecasts: what to reorder, grouped by supplier, with quantities, costs and reasons. Optionally within a budget or for one supplier. It replaces any older draft. It does NOT order anything.',
    parameters: {
      type: 'object',
      properties: {
        budget_inr: {
          type: 'number',
          description: 'Spend at most this many rupees including GST.',
        },
        supplier: { type: 'string', description: "Only this supplier's products (name)." },
      },
    },
    async run(args, ctx) {
      requireManage(ctx);
      let supplier: string | undefined;
      if (typeof args.supplier === 'string' && args.supplier.trim()) {
        const found = await SupplierModel.findOne(
          { name: containsPattern(args.supplier) },
          { _id: 1 },
        ).lean();
        if (!found) throw AppError.notFound(`No supplier matches "${args.supplier}"`);
        supplier = String(found._id);
      }
      const budget = Number(args.budget_inr);
      const plan = await createRestockPlan(
        {
          ...(supplier && { supplier }),
          ...(Number.isFinite(budget) && budget > 0 && { budget: rupeesToPaise(budget) }),
          source: 'manual',
        },
        ctx.user.id,
        'assistant',
      );
      ctx.plan = plan;
      return planSummary(plan);
    },
  },
  {
    name: 'update_restock_plan',
    description:
      'Change the draft restock plan that is waiting for review: set quantities, remove items (quantity 0) or add products. Lines not mentioned stay as they are. It does NOT order anything.',
    parameters: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          description: 'One entry per product to change.',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string', description: 'Product name or SKU.' },
              quantity: { type: 'number', description: 'New quantity; 0 removes the product.' },
            },
            required: ['product', 'quantity'],
          },
        },
      },
      required: ['changes'],
    },
    async run(args, ctx) {
      requireManage(ctx);
      const draft = await RestockPlanModel.findOne({
        status: 'draft',
        expiresAt: { $gt: new Date() },
      })
        .sort({ createdAt: -1 })
        .lean();
      if (!draft) throw AppError.conflict('There is no draft restock plan. Prepare one first.');
      const lines = new Map(draft.items.map((i) => [String(i.product), i.quantity]));
      const changes = Array.isArray(args.changes)
        ? (args.changes as Record<string, unknown>[])
        : [];
      if (changes.length === 0) throw AppError.badRequest('Say which products to change');
      for (const change of changes) {
        const product = await findProduct(String(change.product ?? ''));
        const quantity = Number(change.quantity);
        if (!Number.isFinite(quantity) || quantity < 0) {
          throw AppError.badRequest(`Give a quantity of 0 or more for ${product.name}`);
        }
        if (quantity === 0) lines.delete(String(product._id));
        else lines.set(String(product._id), quantity);
      }
      if (lines.size === 0)
        throw AppError.badRequest('That would leave the plan empty; cancel it instead');
      const plan = await updateRestockPlan(String(draft._id), {
        items: [...lines].map(([product, quantity]) => ({ product, quantity })),
      });
      ctx.plan = plan;
      return planSummary(plan);
    },
  },
];

/** The draft waiting for review, so the model knows which plan "it" refers to. */
export async function currentDraft() {
  const draft = await RestockPlanModel.findOne(
    { status: 'draft', expiresAt: { $gt: new Date() } },
    { _id: 1 },
  )
    .sort({ createdAt: -1 })
    .lean();
  return draft ? getRestockPlan(String(draft._id)) : undefined;
}
