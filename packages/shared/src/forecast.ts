import { FESTIVAL_CALENDAR, festivalOn, type Festival } from './festivals.js';
import { addDays } from './reports.js';

/**
 * Demand forecasting: Holt-Winters exponential smoothing (level, trend and a weekly season)
 * fitted to each product's daily sales, with festival build-ups learned from past festivals.
 * Pure functions; the API feeds them sales history from the database.
 */

/** A product's daily sales, oldest first, ending with the last complete day. */
export interface DemandHistory {
  /** First day of `quantities` (IST, YYYY-MM-DD). */
  start: string;
  quantities: number[];
  /**
   * Days the product ended with no stock. What sold that day is only a lower bound on what
   * customers wanted, so the model does not learn "nobody wants it" from an empty shelf.
   */
  stockedOut: boolean[];
}

export type ForecastMethod = 'holt-winters' | 'moving-average' | 'none';

export interface DemandModel {
  method: ForecastMethod;
  /** Smoothing weights chosen by the fit (Holt-Winters only). */
  alpha: number;
  beta: number;
  gamma: number;
  /** State after the last day of history. */
  level: number;
  trend: number;
  /** Weekly season by weekday, Sunday first: how many units above or below the level. */
  season: number[];
  /** Spread of one-day-ahead errors, in units. */
  sigma: number;
  /** Learned lift at the peak of each festival seen in the history, e.g. { Diwali: 3.4 }. */
  festivalUplift: Record<string, number>;
  /** Lift used for festivals not seen in the history. */
  generalUplift: number;
  /** Last day of history (IST). */
  lastDate: string;
  /** Days of history used, from the first sale. */
  historyDays: number;
  /** Average daily sales over the last 28 days and the 28 before, ignoring empty-shelf days. */
  recent: { last28: number; previous28: number };
  /** Days since the last sale, or null if it never sold. */
  daysSinceSale: number | null;
}

export interface ForecastDay {
  date: string;
  expected: number;
  /** 80% range. */
  low: number;
  high: number;
  festival?: string;
}

/** Below this many days of history, a moving average is used instead of Holt-Winters. */
export const MIN_HOLT_WINTERS_DAYS = 28;
const SEASON = 7;
const INIT_DAYS = 2 * SEASON;
const ALPHAS = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7];
const BETAS = [0, 0.01, 0.05];
const GAMMAS = [0.02, 0.05, 0.1, 0.2, 0.3];
/**
 * Trend damping. Daily shop sales are noisy, so a few slow days must not be projected weeks
 * ahead: with φ = 0.8 the trend adds at most 4 days' worth of change to any forecast.
 */
export const TREND_DAMPING = 0.8;
const Z80 = 1.2816;

const weekday = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();
const mean = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface Prepared {
  start: string;
  y: number[];
  stockedOut: boolean[];
  /** Weekday of each day, Sunday = 0. */
  weekday: number[];
  /** Festival build-up weight per day (0 outside). */
  weight: number[];
  festival: (string | undefined)[];
}

/** Drops the days before the first sale (a product added later has no demand before it). */
function prepare(history: DemandHistory, calendar: readonly Festival[]): Prepared | undefined {
  const first = history.quantities.findIndex((q) => q > 0);
  if (first < 0) return undefined;
  const start = addDays(history.start, first);
  const y = history.quantities.slice(first);
  const days = y.map((_, i) => festivalOn(addDays(start, i), calendar));
  return {
    start,
    y,
    stockedOut: history.stockedOut.slice(first),
    weekday: y.map((_, i) => (weekday(start) + i) % SEASON),
    weight: days.map((d) => d?.weight ?? 0),
    festival: days.map((d) => d?.festival.name),
  };
}

interface FestivalObservation {
  name: string;
  weight: number;
  actual: number;
  baseline: number;
}

interface RunResult {
  sse: number;
  level: number;
  trend: number;
  season: number[];
  errors: number[];
  festivals: FestivalObservation[];
}

/**
 * One pass of additive Holt-Winters with a damped trend over the history:
 *   level   ℓ(t) = α (y(t) − s(t−m)) + (1 − α)(ℓ(t−1) + φ b(t−1))
 *   trend   b(t) = β (ℓ(t) − ℓ(t−1)) + (1 − β) φ b(t−1)
 *   season  s(t) = γ (y(t) − ℓ(t)) + (1 − γ) s(t−m)
 * Festival build-up days are skipped (and recorded, to learn the uplift); empty-shelf days use
 * the forecast when it is higher than what sold. Both are left out of the error.
 */
function run(p: Prepared, alpha: number, beta: number, gamma: number, phi: number): RunResult {
  const { y } = p;
  const firstWeek = mean(y.slice(0, SEASON));
  const secondWeek = mean(y.slice(SEASON, INIT_DAYS));
  let level = mean(y.slice(0, INIT_DAYS));
  let trend = (secondWeek - firstWeek) / SEASON;
  const season = Array.from({ length: SEASON }, () => 0);
  for (let i = 0; i < INIT_DAYS; i++) {
    const weekMean = i < SEASON ? firstWeek : secondWeek;
    season[p.weekday[i]!]! += (y[i]! - weekMean) / 2;
  }
  const initDrift = mean(season);
  for (let i = 0; i < SEASON; i++) season[i]! -= initDrift;

  let sse = 0;
  const errors: number[] = [];
  const festivals: FestivalObservation[] = [];
  for (let t = INIT_DAYS; t < y.length; t++) {
    const w = p.weekday[t]!;
    const forecast = Math.max(0, level + phi * trend + season[w]!);
    if (p.weight[t]! > 0) {
      if (!p.stockedOut[t]) {
        festivals.push({
          name: p.festival[t]!,
          weight: p.weight[t]!,
          actual: y[t]!,
          baseline: forecast,
        });
      }
      level += phi * trend;
      trend *= phi;
      continue;
    }
    let observed = y[t]!;
    if (p.stockedOut[t]) observed = Math.max(observed, forecast);
    else {
      const error = observed - forecast;
      sse += error * error;
      errors.push(error);
    }
    const nextLevel = alpha * (observed - season[w]!) + (1 - alpha) * (level + phi * trend);
    trend = beta * (nextLevel - level) + (1 - beta) * phi * trend;
    season[w] = gamma * (observed - nextLevel) + (1 - gamma) * season[w]!;
    level = nextLevel;
    // Keep the weekly pattern centred on zero, so it cannot slowly absorb the level.
    const drift = mean(season);
    for (let i = 0; i < SEASON; i++) season[i]! -= drift;
    level += drift;
  }
  return { sse, level, trend, season, errors, festivals };
}

/**
 * Least-squares fit of actual = baseline × (1 + (U − 1) × weight) for the peak lift U, pulled
 * towards `prior` by `strength` pseudo-days of evidence so that one noisy festival week does
 * not decide it.
 */
function upliftOf(observations: FestivalObservation[], prior: number, strength: number): number {
  let numerator = 0;
  let denominator = 0;
  for (const o of observations) {
    const expected = o.baseline * (1 + (prior - 1) * o.weight);
    numerator += o.baseline * o.weight * (o.actual - expected);
    denominator += (o.baseline * o.weight) ** 2;
  }
  return clamp(prior + numerator / (denominator + strength), 0.5, 8);
}

/** Each festival's lift is shrunk towards the product's lift over all festivals, which is shrunk towards 1. */
function learnUplifts(observations: FestivalObservation[]) {
  const typical = mean(observations.map((o) => o.baseline)) || 1;
  const strength = (k: number) => k * typical * typical;
  const generalUplift = upliftOf(observations, 1, strength(3));
  const byName = new Map<string, FestivalObservation[]>();
  for (const o of observations) byName.set(o.name, [...(byName.get(o.name) ?? []), o]);
  const festivalUplift: Record<string, number> = {};
  for (const [name, list] of byName) {
    festivalUplift[name] = round2(upliftOf(list, generalUplift, strength(3)));
  }
  return { festivalUplift, generalUplift: round2(generalUplift) };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const std = (values: number[]) => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
};

function recentAverages(p: Prepared | undefined, history: DemandHistory) {
  const window = (fromEnd: number) => {
    const end = history.quantities.length - fromEnd;
    const values: number[] = [];
    for (let i = Math.max(0, end - 28); i < end; i++) {
      if (!history.stockedOut[i]) values.push(history.quantities[i]!);
    }
    return round2(mean(values));
  };
  return p ? { last28: window(0), previous28: window(28) } : { last28: 0, previous28: 0 };
}

/** Fits a demand model to a product's daily sales. */
export function fitDemandModel(
  history: DemandHistory,
  calendar: readonly Festival[] = FESTIVAL_CALENDAR,
): DemandModel {
  const n = history.quantities.length;
  const lastDate = addDays(history.start, n - 1);
  let lastSale = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (history.quantities[i]! > 0) {
      lastSale = i;
      break;
    }
  }
  const p = prepare(history, calendar);
  const base = {
    alpha: 0,
    beta: 0,
    gamma: 0,
    trend: 0,
    season: Array.from({ length: SEASON }, () => 0),
    festivalUplift: {},
    generalUplift: 1,
    lastDate,
    historyDays: p?.y.length ?? 0,
    recent: recentAverages(p, history),
    daysSinceSale: lastSale < 0 ? null : n - 1 - lastSale,
  };
  if (!p) return { ...base, method: 'none', level: 0, sigma: 0 };

  if (p.y.length < MIN_HOLT_WINTERS_DAYS) {
    const usable = p.y.filter((_, i) => !p.stockedOut[i] && p.weight[i] === 0).slice(-14);
    const values = usable.length > 0 ? usable : p.y;
    return { ...base, method: 'moving-average', level: mean(values), sigma: std(values) };
  }

  let best: { alpha: number; beta: number; gamma: number; sse: number } | undefined;
  for (const alpha of ALPHAS) {
    for (const beta of BETAS) {
      for (const gamma of GAMMAS) {
        const { sse } = run(p, alpha, beta, gamma, TREND_DAMPING);
        if (!best || sse < best.sse - 1e-9) best = { alpha, beta, gamma, sse };
      }
    }
  }
  const fit = run(p, best!.alpha, best!.beta, best!.gamma, TREND_DAMPING);
  return {
    ...base,
    method: 'holt-winters',
    alpha: best!.alpha,
    beta: best!.beta,
    gamma: best!.gamma,
    level: fit.level,
    trend: fit.trend,
    season: fit.season,
    sigma: std(fit.errors),
    ...learnUplifts(fit.festivals),
  };
}

/**
 * Expected sales for the `days` after the history ends:
 *   ŷ(t+h) = ℓ(t) + (φ + φ² + … + φʰ)·b(t) + s(t+h−m), times the festival lift during a build-up.
 */
export function forecastDemand(
  model: DemandModel,
  days: number,
  calendar: readonly Festival[] = FESTIVAL_CALENDAR,
): ForecastDay[] {
  return Array.from({ length: days }, (_, i) => {
    const h = i + 1;
    const date = addDays(model.lastDate, h);
    if (model.method === 'none') return { date, expected: 0, low: 0, high: 0 };
    const phi = TREND_DAMPING;
    const damped = (phi * (1 - phi ** h)) / (1 - phi);
    const base = Math.max(0, model.level + damped * model.trend + model.season[weekday(date)]!);
    const fest = festivalOn(date, calendar);
    const lift = fest
      ? 1 + ((model.festivalUplift[fest.festival.name] ?? model.generalUplift) - 1) * fest.weight
      : 1;
    const expected = base * lift;
    const spread =
      Z80 * model.sigma * Math.sqrt(1 + (h - 1) * model.alpha * model.alpha) * Math.max(lift, 1);
    return {
      date,
      expected: round2(expected),
      low: round2(Math.max(0, expected - spread)),
      high: round2(expected + spread),
      ...(fest && { festival: fest.festival.name }),
    };
  });
}

export interface Backtest {
  /** Mean absolute percentage error of weekly totals over the hold-out weeks. */
  mape: number;
  /** The same for a 28-day moving average, for comparison. */
  baselineMape: number;
  weeks: number;
  /** Unit totals over those weeks, for error and bias across many products. */
  totals: {
    actual: number;
    forecast: number;
    error: number;
    baselineForecast: number;
    baselineError: number;
  };
}

/**
 * Accuracy on data the model has not seen: fits on all but the last `holdoutDays`, forecasts
 * them, and compares weekly totals. Weeks with an empty shelf are left out (their true demand
 * is unknown).
 */
export function backtest(
  history: DemandHistory,
  holdoutDays = 28,
  calendar: readonly Festival[] = FESTIVAL_CALENDAR,
): Backtest | undefined {
  const n = history.quantities.length;
  const cut = n - holdoutDays;
  if (cut < MIN_HOLT_WINTERS_DAYS) return undefined;
  const train = {
    start: history.start,
    quantities: history.quantities.slice(0, cut),
    stockedOut: history.stockedOut.slice(0, cut),
  };
  const model = fitDemandModel(train, calendar);
  if (model.method !== 'holt-winters') return undefined;
  const forecast = forecastDemand(model, holdoutDays, calendar);
  const recent = train.quantities.slice(-28).filter((_, i) => !train.stockedOut.slice(-28)[i]);
  const baselineDaily = mean(recent);

  const errors: number[] = [];
  const baselineErrors: number[] = [];
  const totals = { actual: 0, forecast: 0, error: 0, baselineForecast: 0, baselineError: 0 };
  for (let week = 0; week + SEASON <= holdoutDays; week += SEASON) {
    const range = Array.from({ length: SEASON }, (_, i) => cut + week + i);
    if (range.some((i) => history.stockedOut[i])) continue;
    const actual = range.reduce((a, i) => a + history.quantities[i]!, 0);
    if (actual <= 0) continue;
    const predicted = range.reduce((a, i) => a + forecast[i - cut]!.expected, 0);
    const baseline = baselineDaily * SEASON;
    errors.push(Math.abs(predicted - actual) / actual);
    baselineErrors.push(Math.abs(baseline - actual) / actual);
    totals.actual += actual;
    totals.forecast += predicted;
    totals.error += Math.abs(predicted - actual);
    totals.baselineForecast += baseline;
    totals.baselineError += Math.abs(baseline - actual);
  }
  if (errors.length === 0) return undefined;
  return {
    mape: round2(mean(errors) * 100),
    baselineMape: round2(mean(baselineErrors) * 100),
    weeks: errors.length,
    totals,
  };
}

// --- Restock advice ------------------------------------------------------------------------

/** z for a 95% chance of not running out while waiting for a delivery. */
export const SERVICE_LEVEL_Z = 1.65;
/** Each order covers the lead time plus about a week, until the next review. */
export const REVIEW_DAYS = 7;
/** No sale in this many days with stock on the shelf: dead stock, never reordered. */
export const DEAD_STOCK_DAYS = 60;
const STOCKOUT_HORIZON = 120;
/** "Order soon": stock + on order reaches the reorder point within this many days. */
export const WATCH_DAYS = 3;

export interface RestockInputs {
  stock: number;
  onOrder: number;
  leadTimeDays: number;
  /** Orders are rounded up to whole packs (cartons, crates). */
  packSize: number;
  /** The owner's own minimum: never let stock + on order fall below this. */
  reorderLevel: number;
}

/**
 * reorder: order now. watch: will need an order within a few days. ordered: short on the shelf,
 * but goods already on order cover it. ok: enough stock. dead: not selling. new: no sales yet.
 */
export type RestockStatus = 'reorder' | 'watch' | 'ordered' | 'ok' | 'dead' | 'new';

export interface RestockAdvice {
  status: RestockStatus;
  /** Expected sales per day over the next week. */
  dailyDemand: number;
  /** Expected sales until a delivery ordered today arrives. */
  leadTimeDemand: number;
  safetyStock: number;
  /** Reorder once stock + on order is at or below this. */
  reorderPoint: number;
  /** Suggested order, in whole packs; 0 when no order is needed. */
  suggestedQuantity: number;
  /** Days the stock on the shelf lasts, or null if longer than 120 days. */
  daysUntilStockout: number | null;
  /** Festival whose build-up falls before the next delivery or the review after it. */
  festival?: { name: string; inDays: number; uplift: number };
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const roundUp = (quantity: number, pack: number) =>
  quantity <= 0 ? 0 : Math.ceil(quantity / pack - 1e-9) * pack;

export function adviseRestock(
  model: DemandModel,
  inputs: RestockInputs,
  calendar: readonly Festival[] = FESTIVAL_CALENDAR,
): RestockAdvice {
  const lead = Math.max(1, Math.round(inputs.leadTimeDays));
  const pack = Math.max(1, inputs.packSize);
  const forecast = forecastDemand(model, STOCKOUT_HORIZON, calendar);
  const sum = (days: number) => forecast.slice(0, days).reduce((a, d) => a + d.expected, 0);

  /** Days until `quantity` is used up, or null if it lasts beyond the horizon. */
  const lasts = (quantity: number) => {
    let left = quantity;
    for (const [i, day] of forecast.entries()) {
      left -= day.expected;
      if (left < 0) return i;
    }
    return null;
  };
  const daysUntilStockout = lasts(inputs.stock);

  const leadTimeDemand = sum(lead);
  const safetyStock = SERVICE_LEVEL_Z * model.sigma * Math.sqrt(lead);
  const reorderPoint = leadTimeDemand + safetyStock;
  const position = inputs.stock + inputs.onOrder;
  const dailyDemand = sum(SEASON) / SEASON;

  const cover = lead + REVIEW_DAYS;
  const festivalDay = forecast.slice(0, cover).find((d) => d.festival);
  const festivalInfo =
    festivalDay &&
    calendar.find((f) => f.name === festivalDay.festival && f.date >= festivalDay.date);
  const uplift = festivalInfo
    ? (model.festivalUplift[festivalInfo.name] ?? model.generalUplift)
    : 1;

  const result = {
    dailyDemand: round2(dailyDemand),
    leadTimeDemand: round2(leadTimeDemand),
    safetyStock: round2(safetyStock),
    reorderPoint: round2(reorderPoint),
    daysUntilStockout,
    ...(festivalInfo &&
      uplift >= 1.2 && {
        festival: {
          name: festivalInfo.name,
          inDays: daysBetween(addDays(model.lastDate, 1), festivalInfo.date),
          uplift,
        },
      }),
  };

  if (model.method === 'none') {
    return { ...result, status: inputs.stock > 0 ? 'dead' : 'new', suggestedQuantity: 0 };
  }
  if (inputs.stock > 0 && (model.daysSinceSale ?? 0) >= DEAD_STOCK_DAYS) {
    return { ...result, status: 'dead', suggestedQuantity: 0 };
  }

  // Reorder at the reorder point, at the owner's own level, or when stock and goods on order
  // would not last until a delivery ordered today arrives.
  const floor = Math.max(reorderPoint, inputs.reorderLevel);
  const positionLasts = lasts(position);
  if (position <= floor + 1e-9 || (positionLasts !== null && positionLasts <= lead)) {
    const target = Math.max(sum(cover) + safetyStock, inputs.reorderLevel + sum(REVIEW_DAYS));
    const suggestedQuantity = Math.max(pack, roundUp(target - position, pack));
    return { ...result, status: 'reorder', suggestedQuantity };
  }
  const shelfShort =
    inputs.stock <= floor + 1e-9 || (daysUntilStockout !== null && daysUntilStockout <= lead);
  const status =
    inputs.onOrder > 0 && shelfShort
      ? 'ordered'
      : position <= floor + WATCH_DAYS * dailyDemand
        ? 'watch'
        : 'ok';
  return { ...result, status, suggestedQuantity: 0 };
}

const formatCount = (value: number) =>
  value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);

/**
 * Plain-English reasons for a suggestion, e.g.
 * ["Sells about 12 a day, 30% more than last month", "18 left: about 2 days", "Supplier takes 3 days"].
 */
export function restockReasons(
  model: DemandModel,
  advice: RestockAdvice,
  inputs: Pick<RestockInputs, 'stock' | 'onOrder' | 'leadTimeDays'> & { unit?: string },
): string[] {
  const unit = inputs.unit && inputs.unit !== 'pcs' ? ` ${inputs.unit}` : '';
  const reasons: string[] = [];
  if (advice.status === 'dead') {
    reasons.push(
      model.daysSinceSale === null
        ? 'Has never sold'
        : `No sale in ${model.daysSinceSale} days, so it is not reordered`,
    );
    return reasons;
  }

  let rate = `Sells about ${formatCount(advice.dailyDemand)}${unit} a day`;
  const { last28, previous28 } = model.recent;
  if (previous28 > 0 && last28 > 0) {
    const change = Math.round(((last28 - previous28) / previous28) * 100);
    if (Math.abs(change) >= 15) {
      rate += `, ${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than the month before`;
    }
  }
  reasons.push(rate);

  if (inputs.stock <= 0) reasons.push('Out of stock now');
  else if (advice.daysUntilStockout !== null) {
    const days = advice.daysUntilStockout;
    reasons.push(
      `${formatCount(inputs.stock)}${unit} left: ${days === 0 ? 'runs out today' : `about ${days} day${days === 1 ? '' : 's'}`}`,
    );
  }
  if (inputs.onOrder > 0) reasons.push(`${formatCount(inputs.onOrder)}${unit} already on order`);
  if (advice.festival) {
    const { name, inDays, uplift } = advice.festival;
    reasons.push(
      `${name} ${inDays <= 0 ? 'is here' : `in ${inDays} day${inDays === 1 ? '' : 's'}`}: expected to lift sales ${uplift.toFixed(1)}×`,
    );
  }
  const lead = Math.round(inputs.leadTimeDays);
  reasons.push(`Supplier takes ${lead} day${lead === 1 ? '' : 's'}`);
  return reasons;
}
