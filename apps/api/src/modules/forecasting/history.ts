import { addDays, BUSINESS_TIME_ZONE, daysOf, istDayRange, type DemandHistory } from '@ims/shared';
import type { Types } from 'mongoose';
import { SaleModel, StockMovementModel } from '../../models/index.js';

/** A year of history plus a week, so last year's festivals are in it. */
export const HISTORY_DAYS = 371;

const dayOf = (field: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: BUSINESS_TIME_ZONE },
});

/**
 * Each product's units sold per IST day, up to and including yesterday (today is not over),
 * and whether it ended each day with an empty shelf. Cancelled bills do not count; returned
 * goods still do, since the customer wanted them on the day.
 */
export async function loadDemandHistories(
  productIds: Types.ObjectId[],
  today: string,
): Promise<Map<string, DemandHistory>> {
  const start = addDays(today, -HISTORY_DAYS);
  const days = daysOf(start, addDays(today, -1));
  const index = new Map(days.map((d, i) => [d, i]));
  const from = istDayRange(start).start;
  const until = istDayRange(today).start;

  const sold = await SaleModel.aggregate<{
    _id: { product: Types.ObjectId; day: string };
    quantity: number;
  }>([
    { $match: { soldAt: { $gte: from, $lt: until }, status: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    { $match: { 'items.product': { $in: productIds } } },
    {
      $group: {
        _id: { product: '$items.product', day: dayOf('$soldAt') },
        quantity: { $sum: '$items.quantity' },
      },
    },
  ]);
  // Closing stock: the balance after the last movement of each day, and before the first day.
  const closing = await StockMovementModel.aggregate<{
    _id: { product: Types.ObjectId; day: string | null };
    balance: number;
  }>([
    { $match: { product: { $in: productIds }, occurredAt: { $lt: until } } },
    { $sort: { occurredAt: 1, _id: 1 } },
    {
      $group: {
        _id: {
          product: '$product',
          day: { $cond: [{ $lt: ['$occurredAt', from] }, null, dayOf('$occurredAt')] },
        },
        balance: { $last: '$balanceAfter' },
      },
    },
  ]);

  const histories = new Map<string, DemandHistory>();
  const balances = new Map<string, { opening?: number; byDay: (number | undefined)[] }>();
  for (const id of productIds) {
    histories.set(String(id), {
      start,
      quantities: days.map(() => 0),
      stockedOut: days.map(() => false),
    });
    balances.set(String(id), { byDay: days.map(() => undefined) });
  }
  for (const row of sold) {
    const i = index.get(row._id.day);
    const history = histories.get(String(row._id.product));
    if (i !== undefined && history) history.quantities[i] = Math.round(row.quantity * 1000) / 1000;
  }
  for (const row of closing) {
    const b = balances.get(String(row._id.product));
    if (!b) continue;
    if (row._id.day === null) b.opening = row.balance;
    else {
      const i = index.get(row._id.day);
      if (i !== undefined) b.byDay[i] = row.balance;
    }
  }
  for (const [id, b] of balances) {
    const history = histories.get(id)!;
    let balance = b.opening;
    for (let i = 0; i < days.length; i++) {
      balance = b.byDay[i] ?? balance;
      history.stockedOut[i] = balance !== undefined && balance <= 0;
    }
  }
  return histories;
}
