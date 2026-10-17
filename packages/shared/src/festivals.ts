import { addDays } from './reports.js';

/**
 * Festivals that change what an Indian shop sells. Shopping builds up over `leadDays` before the
 * day itself. Lunar festival dates are approximate. The forecasting engine learns how much each
 * one lifts each product from past sales; the calendar only says when they fall.
 */
export interface Festival {
  name: string;
  /** IST calendar date (YYYY-MM-DD). */
  date: string;
  leadDays: number;
}

export const FESTIVAL_CALENDAR: readonly Festival[] = [
  { name: 'Dussehra', date: '2025-10-02', leadDays: 4 },
  { name: 'Diwali', date: '2025-10-20', leadDays: 8 },
  { name: 'Christmas', date: '2025-12-25', leadDays: 3 },
  { name: 'Makar Sankranti', date: '2026-01-14', leadDays: 2 },
  { name: 'Holi', date: '2026-03-04', leadDays: 3 },
  { name: 'Eid al-Fitr', date: '2026-03-20', leadDays: 3 },
  { name: 'Raksha Bandhan', date: '2026-08-28', leadDays: 2 },
  { name: 'Ganesh Chaturthi', date: '2026-09-14', leadDays: 3 },
  { name: 'Dussehra', date: '2026-10-20', leadDays: 9 },
  { name: 'Diwali', date: '2026-11-08', leadDays: 8 },
  { name: 'Christmas', date: '2026-12-25', leadDays: 3 },
  { name: 'Makar Sankranti', date: '2027-01-14', leadDays: 2 },
  { name: 'Eid al-Fitr', date: '2027-03-10', leadDays: 3 },
  { name: 'Holi', date: '2027-03-22', leadDays: 3 },
  { name: 'Raksha Bandhan', date: '2027-08-17', leadDays: 2 },
  { name: 'Ganesh Chaturthi', date: '2027-09-04', leadDays: 3 },
  { name: 'Dussehra', date: '2027-10-09', leadDays: 9 },
  { name: 'Diwali', date: '2027-10-29', leadDays: 8 },
];

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The festival whose shopping build-up a day falls in, with how far into it: the weight rises
 * from just above 0 at the start of the build-up to 1 on the festival itself.
 */
export function festivalOn(
  dateKey: string,
  calendar: readonly Festival[] = FESTIVAL_CALENDAR,
): { festival: Festival; weight: number } | undefined {
  let best: { festival: Festival; weight: number } | undefined;
  for (const festival of calendar) {
    const before = daysBetween(dateKey, festival.date);
    if (before < 0 || before > festival.leadDays) continue;
    const weight = 1 - before / (festival.leadDays + 1);
    if (!best || weight > best.weight) best = { festival, weight };
  }
  return best;
}

/** The next festival on or after a day, within `withinDays`. */
export function nextFestival(
  dateKey: string,
  withinDays: number,
  calendar: readonly Festival[] = FESTIVAL_CALENDAR,
): { festival: Festival; inDays: number } | undefined {
  const last = addDays(dateKey, withinDays);
  const festival = calendar.find((f) => f.date >= dateKey && f.date <= last);
  return festival && { festival, inDays: daysBetween(dateKey, festival.date) };
}
