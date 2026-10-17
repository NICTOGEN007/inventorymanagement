import { describe, expect, it } from 'vitest';
import {
  addDays,
  adviseRestock,
  backtest,
  festivalOn,
  fitDemandModel,
  forecastDemand,
  nextFestival,
  restockReasons,
  type DemandHistory,
  type Festival,
} from '../src/index.js';

// 2026-01-04 is a Sunday.
const START = '2026-01-04';
// Units above or below the level by weekday, Sunday first: busy weekends.
const WEEKLY = [6, -3, -3, -2, -1, 1, 5];

/** Deterministic sales: a level, the weekly pattern and a little alternating noise. */
function series(days: number, level: number, f: (i: number, date: string) => number = () => 1) {
  const quantities = Array.from({ length: days }, (_, i) => {
    const date = addDays(START, i);
    const noise = i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0;
    return Math.max(0, Math.round((level + WEEKLY[i % 7]! + noise) * f(i, date)));
  });
  return { start: START, quantities, stockedOut: quantities.map(() => false) } as DemandHistory;
}

const NO_FESTIVALS: Festival[] = [];

describe('festival calendar', () => {
  const calendar: Festival[] = [{ name: 'Diwali', date: '2026-11-08', leadDays: 3 }];

  it('weights the build-up from the start up to the day itself', () => {
    expect(festivalOn('2026-11-04', calendar)).toBeUndefined();
    expect(festivalOn('2026-11-05', calendar)?.weight).toBeCloseTo(0.25);
    expect(festivalOn('2026-11-07', calendar)?.weight).toBeCloseTo(0.75);
    expect(festivalOn('2026-11-08', calendar)).toEqual({ festival: calendar[0], weight: 1 });
    expect(festivalOn('2026-11-09', calendar)).toBeUndefined();
  });

  it('finds the next festival within a window', () => {
    expect(nextFestival('2026-10-17', 30, calendar)).toEqual({ festival: calendar[0], inDays: 22 });
    expect(nextFestival('2026-10-17', 10, calendar)).toBeUndefined();
  });
});

describe('fitDemandModel and forecastDemand', () => {
  it('learns the level and the weekly pattern', () => {
    const model = fitDemandModel(series(140, 20), NO_FESTIVALS);
    expect(model.method).toBe('holt-winters');
    expect(model.level).toBeGreaterThan(18);
    expect(model.level).toBeLessThan(22);

    const week = forecastDemand(model, 7, NO_FESTIVALS);
    // The history ends on a Saturday, so the forecast starts on a Sunday.
    expect(week[0]!.date).toBe(addDays(START, 140));
    expect(new Date(`${week[0]!.date}T00:00:00Z`).getUTCDay()).toBe(0);
    const sunday = week[0]!.expected;
    const monday = week[1]!.expected;
    expect(sunday).toBeGreaterThan(monday + 5);
    expect(sunday).toBeGreaterThan(23);
    expect(monday).toBeLessThan(19);
    for (const day of week) {
      expect(day.low).toBeLessThanOrEqual(day.expected);
      expect(day.high).toBeGreaterThanOrEqual(day.expected);
    }
  });

  it('does not learn "no demand" from an empty shelf', () => {
    const history = series(140, 20);
    for (let i = 126; i < 140; i++) {
      history.quantities[i] = 0;
      history.stockedOut[i] = true;
    }
    const aware = fitDemandModel(history, NO_FESTIVALS);
    const average = (m: ReturnType<typeof fitDemandModel>) =>
      forecastDemand(m, 7, NO_FESTIVALS).reduce((a, d) => a + d.expected, 0) / 7;
    expect(average(aware)).toBeGreaterThan(17);

    const naive = fitDemandModel(
      { ...history, stockedOut: history.stockedOut.map(() => false) },
      NO_FESTIVALS,
    );
    expect(average(naive)).toBeLessThan(average(aware) - 5);
  });

  it('learns a festival lift from past festivals and applies it to the next one', () => {
    const calendar: Festival[] = [
      { name: 'Holi', date: addDays(START, 60), leadDays: 4 },
      { name: 'Eid al-Fitr', date: addDays(START, 100), leadDays: 4 },
      { name: 'Diwali', date: addDays(START, 145), leadDays: 4 },
    ];
    // Sales triple at the peak of each build-up.
    const history = series(140, 20, (_, date) => {
      const fest = festivalOn(date, calendar);
      return fest ? 1 + 2 * fest.weight : 1;
    });
    const model = fitDemandModel(history, calendar);
    // Two short build-ups are little evidence, so the lift is pulled part of the way towards 1×.
    expect(model.festivalUplift.Holi).toBeGreaterThan(2);
    expect(model.festivalUplift.Holi).toBeLessThan(3.2);
    expect(model.generalUplift).toBeGreaterThan(2);

    const ahead = forecastDemand(model, 7, calendar);
    const peak = ahead.find((d) => d.date === addDays(START, 145))!;
    expect(peak.festival).toBe('Diwali');
    // A Friday at the peak: (20 + 1) × the learned lift.
    expect(peak.expected).toBeGreaterThan(21 * 2);
    expect(ahead[0]!.festival).toBeUndefined();
  });

  it('uses a moving average for a short history and nothing when it never sold', () => {
    const short = fitDemandModel(series(20, 10), NO_FESTIVALS);
    expect(short.method).toBe('moving-average');
    expect(forecastDemand(short, 1, NO_FESTIVALS)[0]!.expected).toBeCloseTo(short.level);

    const never = fitDemandModel(
      { start: START, quantities: Array(60).fill(0), stockedOut: Array(60).fill(false) },
      NO_FESTIVALS,
    );
    expect(never.method).toBe('none');
    expect(never.daysSinceSale).toBeNull();
    expect(forecastDemand(never, 3, NO_FESTIVALS).every((d) => d.expected === 0)).toBe(true);
  });

  it('ignores the days before the first sale', () => {
    const history = series(140, 20);
    const late = {
      start: addDays(START, -70),
      quantities: [...Array(70).fill(0), ...history.quantities],
      stockedOut: [...Array(70).fill(false), ...history.stockedOut],
    };
    const model = fitDemandModel(late, NO_FESTIVALS);
    expect(model.historyDays).toBe(140);
    expect(model.level).toBeGreaterThan(18);
  });
});

describe('backtest', () => {
  it('measures weekly accuracy on held-out days against a moving average', () => {
    const result = backtest(series(196, 20), 28, NO_FESTIVALS)!;
    expect(result.weeks).toBe(4);
    expect(result.mape).toBeLessThan(10);
    expect(result.baselineMape).toBeGreaterThanOrEqual(0);
  });

  it('needs enough history', () => {
    expect(backtest(series(40, 20), 28, NO_FESTIVALS)).toBeUndefined();
  });
});

describe('adviseRestock', () => {
  const model = fitDemandModel(series(140, 20), NO_FESTIVALS);
  const inputs = { stock: 30, onOrder: 0, leadTimeDays: 3, packSize: 12, reorderLevel: 10 };

  it('reorders when stock will not last until a delivery, in whole packs', () => {
    const advice = adviseRestock(model, inputs, NO_FESTIVALS);
    expect(advice.status).toBe('reorder');
    expect(advice.leadTimeDemand).toBeGreaterThan(55);
    expect(advice.safetyStock).toBeGreaterThan(0);
    expect(advice.reorderPoint).toBeCloseTo(advice.leadTimeDemand + advice.safetyStock, 1);
    expect(advice.daysUntilStockout).toBe(1);
    // Lead time + a week of demand + safety stock − stock, rounded up to packs of 12.
    expect(advice.suggestedQuantity % 12).toBe(0);
    expect(advice.suggestedQuantity).toBeGreaterThan(200 - 30 - 12);
    expect(advice.suggestedQuantity).toBeLessThan(230);
  });

  it('reorders when stock would not last until a delivery, even above the reorder point', () => {
    const advice = adviseRestock(
      model,
      { stock: 40, onOrder: 0, leadTimeDays: 1, packSize: 1, reorderLevel: 0 },
      NO_FESTIVALS,
    );
    expect(40).toBeGreaterThan(advice.reorderPoint);
    expect(advice.daysUntilStockout).toBe(1);
    expect(advice.status).toBe('reorder');
  });

  it('counts goods already on order', () => {
    const covered = adviseRestock(model, { ...inputs, onOrder: 400 }, NO_FESTIVALS);
    // Short on the shelf, but the delivery covers it.
    expect(covered.status).toBe('ordered');
    expect(covered.suggestedQuantity).toBe(0);
    const partly = adviseRestock(model, { ...inputs, onOrder: 60 }, NO_FESTIVALS);
    expect(partly.suggestedQuantity).toBeLessThan(
      adviseRestock(model, inputs, NO_FESTIVALS).suggestedQuantity,
    );
  });

  it('watches stock that will need an order within a few days', () => {
    const soon = adviseRestock(model, { ...inputs, stock: 110 }, NO_FESTIVALS);
    expect(soon.status).toBe('watch');
    expect(soon.suggestedQuantity).toBe(0);
    expect(adviseRestock(model, { ...inputs, stock: 300 }, NO_FESTIVALS).status).toBe('ok');
  });

  it("respects the owner's reorder level", () => {
    const slow = fitDemandModel(series(140, 3), NO_FESTIVALS);
    const advice = adviseRestock(
      slow,
      { stock: 40, onOrder: 0, leadTimeDays: 1, packSize: 6, reorderLevel: 50 },
      NO_FESTIVALS,
    );
    expect(advice.status).toBe('reorder');
    expect(advice.suggestedQuantity % 6).toBe(0);
    expect(40 + advice.suggestedQuantity).toBeGreaterThanOrEqual(50);
  });

  it('never reorders dead stock', () => {
    const history = series(140, 20);
    for (let i = 70; i < 140; i++) history.quantities[i] = 0;
    const dead = fitDemandModel(history, NO_FESTIVALS);
    expect(dead.daysSinceSale).toBe(70);
    const advice = adviseRestock(dead, { ...inputs, stock: 5 }, NO_FESTIVALS);
    expect(advice.status).toBe('dead');
    expect(advice.suggestedQuantity).toBe(0);
    expect(restockReasons(dead, advice, { ...inputs, stock: 5 })).toEqual([
      'No sale in 70 days, so it is not reordered',
    ]);
  });

  it('explains the suggestion in plain words', () => {
    const calendar: Festival[] = [
      { name: 'Holi', date: addDays(START, 60), leadDays: 4 },
      { name: 'Diwali', date: addDays(START, 145), leadDays: 4 },
    ];
    const festive = fitDemandModel(
      series(140, 20, (_, date) => {
        const fest = festivalOn(date, calendar);
        return fest ? 1 + 2 * fest.weight : 1;
      }),
      calendar,
    );
    const advice = adviseRestock(festive, { ...inputs, stock: 0, onOrder: 24 }, calendar);
    expect(advice.festival?.name).toBe('Diwali');
    expect(advice.festival?.inDays).toBe(5);
    const reasons = restockReasons(festive, advice, {
      stock: 0,
      onOrder: 24,
      leadTimeDays: 3,
    });
    expect(reasons[0]).toMatch(/^Sells about \d+ a day/);
    expect(reasons).toContain('Out of stock now');
    expect(reasons).toContain('24 already on order');
    expect(reasons.some((r) => /^Diwali in 5 days: expected to lift sales \d\.\d×$/.test(r))).toBe(
      true,
    );
    expect(reasons.at(-1)).toBe('Supplier takes 3 days');
  });
});
