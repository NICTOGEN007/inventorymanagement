import {
  addDays,
  adviseRestock,
  backtest,
  fitDemandModel,
  forecastDemand,
  istDateKey,
  istDayRange,
  restockReasons,
  type DemandHistory,
  type DemandModel,
  type ForecastAccuracyDto,
  type ForecastItemDto,
  type ForecastOverviewDto,
  type GstRate,
  type ProductForecastDto,
  type RestockStatus,
} from '@ims/shared';
import type { Types } from 'mongoose';
import { ProductModel, SaleModel, StockMovementModel, SupplierModel } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { toObjectId } from '../../utils/query.js';
import { onOrderFor } from '../products/service.js';
import { loadDemandHistories } from './history.js';

/**
 * Demand models for every active product. Fitting takes a fraction of a second for a shop's
 * catalogue, but they only change when a day of sales is complete (or old data changes), so
 * they are kept until then. Stock and goods on order are always read fresh.
 */
interface Analysis {
  /** Last full day of history. */
  asOf: string;
  histories: Map<string, DemandHistory>;
  models: Map<string, DemandModel>;
}

let cache: { key: string; analysis: Promise<Analysis> } | undefined;
let accuracyCache: { key: string; accuracy: ForecastAccuracyDto | null } | undefined;

async function cacheKey(today: string, productIds: Types.ObjectId[]) {
  const until = istDayRange(today).start;
  const [sales, movements] = await Promise.all([
    SaleModel.countDocuments({ soldAt: { $lt: until } }),
    StockMovementModel.countDocuments({ occurredAt: { $lt: until } }),
  ]);
  return `${today}|${sales}|${movements}|${productIds.map(String).join(',')}`;
}

async function getAnalysis(
  productIds: Types.ObjectId[],
): Promise<{ key: string; analysis: Analysis }> {
  const today = istDateKey(new Date());
  const key = await cacheKey(today, productIds);
  if (cache?.key !== key) {
    const analysis = loadDemandHistories(productIds, today).then((histories) => ({
      asOf: addDays(today, -1),
      histories,
      models: new Map([...histories].map(([id, h]) => [id, fitDemandModel(h)])),
    }));
    cache = { key, analysis };
    // A failed load must not be served from the cache.
    analysis.catch(() => {
      if (cache?.analysis === analysis) cache = undefined;
    });
  }
  return { key, analysis: await cache.analysis };
}

/** Forgets the fitted models (tests reset the database between cases). */
export function clearForecastCache() {
  cache = undefined;
  accuracyCache = undefined;
}

const PRODUCT_FIELDS = {
  name: 1,
  sku: 1,
  unit: 1,
  stock: 1,
  reorderLevel: 1,
  packSize: 1,
  costPrice: 1,
  gstRate: 1,
  preferredSupplier: 1,
} as const;

type ProductRow = {
  _id: Types.ObjectId;
  name: string;
  sku: string;
  unit: ForecastItemDto['product']['unit'];
  stock: number;
  reorderLevel: number;
  packSize?: number | null;
  costPrice: number;
  gstRate: number;
  preferredSupplier?: Types.ObjectId | null;
};

const DEFAULT_LEAD_TIME = 7;

/** Builds the forecast items for these products (all active ones by default). */
async function buildItems(filter: Record<string, unknown> = {}) {
  const products = await ProductModel.find({ isActive: true, ...filter }, PRODUCT_FIELDS)
    .sort({ name: 1 })
    .lean<ProductRow[]>();
  const all = await ProductModel.find({ isActive: true }, { _id: 1 }).sort({ _id: 1 }).lean();
  const { analysis } = await getAnalysis(all.map((p) => p._id));
  const [suppliers, onOrder] = await Promise.all([
    SupplierModel.find(
      { _id: { $in: products.flatMap((p) => (p.preferredSupplier ? [p.preferredSupplier] : [])) } },
      { name: 1, leadTimeDays: 1, isActive: 1 },
    ).lean(),
    onOrderFor(products.map((p) => p._id)),
  ]);
  const supplierById = new Map(suppliers.map((s) => [String(s._id), s]));

  const items = products.map((p) => {
    const id = String(p._id);
    const model =
      analysis.models.get(id) ??
      fitDemandModel({ start: analysis.asOf, quantities: [0], stockedOut: [false] });
    const supplier = p.preferredSupplier
      ? supplierById.get(String(p.preferredSupplier))
      : undefined;
    const inputs = {
      stock: p.stock,
      onOrder: onOrder.get(id) ?? 0,
      leadTimeDays: supplier?.leadTimeDays ?? DEFAULT_LEAD_TIME,
      packSize: p.packSize ?? 1,
      reorderLevel: p.reorderLevel,
    };
    const advice = adviseRestock(model, inputs);
    const item: ForecastItemDto = {
      product: { id, name: p.name, sku: p.sku, unit: p.unit },
      ...(supplier && {
        supplier: {
          id: String(supplier._id),
          name: supplier.name,
          leadTimeDays: supplier.leadTimeDays,
        },
      }),
      stock: inputs.stock,
      onOrder: inputs.onOrder,
      packSize: inputs.packSize,
      reorderLevel: inputs.reorderLevel,
      status: advice.status,
      method: model.method,
      dailyDemand: advice.dailyDemand,
      leadTimeDemand: advice.leadTimeDemand,
      safetyStock: advice.safetyStock,
      reorderPoint: advice.reorderPoint,
      suggestedQuantity: advice.suggestedQuantity,
      daysUntilStockout: advice.daysUntilStockout,
      ...(advice.festival && { festival: advice.festival }),
      reasons: restockReasons(model, advice, { ...inputs, unit: p.unit }),
      unitCost: p.costPrice,
      gstRate: p.gstRate as GstRate,
    };
    return { item, model, supplierActive: supplier?.isActive !== false };
  });
  return { analysis, items };
}

const STATUS_ORDER: RestockStatus[] = ['reorder', 'watch', 'ordered', 'ok', 'new', 'dead'];
const byUrgency = (a: ForecastItemDto, b: ForecastItemDto) =>
  STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
  (a.daysUntilStockout ?? Infinity) - (b.daysUntilStockout ?? Infinity) ||
  a.product.name.localeCompare(b.product.name);

export async function getForecastOverview(): Promise<ForecastOverviewDto> {
  const { analysis, items } = await buildItems();
  const list = items.map((i) => i.item).sort(byUrgency);
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
    RestockStatus,
    number
  >;
  for (const item of list) counts[item.status]++;
  return { asOf: analysis.asOf, items: list, counts };
}

/** Items for a restock plan: what needs reordering now, most urgent first. */
export async function itemsToReorder(supplier?: Types.ObjectId) {
  const { items } = await buildItems(supplier ? { preferredSupplier: supplier } : {});
  return items
    .filter((i) => i.item.status === 'reorder')
    .map((i) => ({ ...i.item, supplierActive: i.supplierActive }))
    .sort(byUrgency);
}

/** Forecast items for particular products (any status), e.g. ones added to a plan by hand. */
export async function forecastItemsFor(ids: Types.ObjectId[]) {
  const { items } = await buildItems({ _id: { $in: ids } });
  return new Map(items.map((i) => [i.item.product.id, i.item]));
}

export async function getProductForecast(id: string): Promise<ProductForecastDto> {
  const productId = toObjectId(id, 'Product not found');
  const { analysis, items } = await buildItems({ _id: productId });
  const found = items[0];
  if (!found) {
    const exists = await ProductModel.exists({ _id: productId });
    throw exists
      ? AppError.conflict('This product is inactive, so it is not forecast')
      : AppError.notFound('Product not found');
  }
  const history = analysis.histories.get(id);
  const { model } = found;
  const recent = history
    ? history.quantities.slice(-56).map((quantity, i, arr) => ({
        date: addDays(analysis.asOf, i - arr.length + 1),
        quantity,
        stockedOut: history.stockedOut[history.stockedOut.length - arr.length + i]!,
      }))
    : [];
  const result = history && model.method === 'holt-winters' ? backtest(history) : undefined;
  return {
    item: found.item,
    history: recent,
    forecast: forecastDemand(model, 28),
    model: {
      method: model.method,
      alpha: model.alpha,
      beta: model.beta,
      gamma: model.gamma,
      historyDays: model.historyDays,
      season: model.season.map((v) => Math.round(v * 100) / 100),
      festivalUplift: model.festivalUplift,
      generalUplift: model.generalUplift,
    },
    ...(result && { backtest: result }),
  };
}

const pct = (value: number) => Math.round(value * 1000) / 10;

/**
 * How well the forecasts would have done over the last 4 weeks, fitted on the data before them,
 * across every product with enough history; compared with a 28-day moving average.
 */
export async function getForecastAccuracy(): Promise<ForecastAccuracyDto | null> {
  const all = await ProductModel.find({ isActive: true }, { _id: 1 }).sort({ _id: 1 }).lean();
  const { key, analysis } = await getAnalysis(all.map((p) => p._id));
  if (accuracyCache?.key === key) return accuracyCache.accuracy;

  let mapeSum = 0;
  let baselineMapeSum = 0;
  let weeks = 0;
  let products = 0;
  const t = { actual: 0, forecast: 0, error: 0, baselineForecast: 0, baselineError: 0 };
  for (const [id, history] of analysis.histories) {
    if (analysis.models.get(id)?.method !== 'holt-winters') continue;
    if ((analysis.models.get(id)?.daysSinceSale ?? 0) > 28) continue;
    const result = backtest(history);
    if (!result) continue;
    products++;
    weeks += result.weeks;
    mapeSum += result.mape * result.weeks;
    baselineMapeSum += result.baselineMape * result.weeks;
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += result.totals[k];
  }
  const accuracy =
    weeks === 0 || t.actual <= 0
      ? null
      : {
          mape: Math.round((mapeSum / weeks) * 10) / 10,
          wape: pct(t.error / t.actual),
          bias: pct(t.forecast / t.actual - 1),
          baseline: {
            mape: Math.round((baselineMapeSum / weeks) * 10) / 10,
            wape: pct(t.baselineError / t.actual),
            bias: pct(t.baselineForecast / t.actual - 1),
          },
          products,
          weeks,
        };
  accuracyCache = { key, accuracy };
  return accuracy;
}
