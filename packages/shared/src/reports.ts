import type { PaymentMethod, Unit } from './constants.js';
import { istDateKey } from './dates.js';
import type { Paise } from './money.js';

// ---------------------------------------------------------------------------
// Periods. Reports work on IST calendar days written "YYYY-MM-DD", inclusive at both ends.

const DAY_MS = 86_400_000;
const toUtc = (dateKey: string) => Date.parse(`${dateKey}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The day `days` after (or before, when negative) a date key. */
export function addDays(dateKey: string, days: number): string {
  return fromUtc(toUtc(dateKey) + days * DAY_MS);
}

/** Number of days from `from` to `to`, counting both. */
export function daysInPeriod(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** Every day key in the period, oldest first. */
export function daysOf(from: string, to: string): string[] {
  const count = daysInPeriod(from, to);
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(from, i));
}

/** The period of the same length just before this one, for "vs previous period". */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = daysInPeriod(from, to);
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export const REPORT_GROUPINGS = ['day', 'week', 'month'] as const;
export type ReportGrouping = (typeof REPORT_GROUPINGS)[number];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (dateKey: string) => {
  const [, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]}`;
};

/**
 * The bucket a day falls in: the day itself, the Monday that starts its week, or its month
 * ("2026-10"). Weeks run Monday to Sunday, as Indian businesses usually count them.
 */
export function bucketOf(dateKey: string, grouping: ReportGrouping): string {
  if (grouping === 'day') return dateKey;
  if (grouping === 'month') return dateKey.slice(0, 7);
  const weekday = new Date(toUtc(dateKey)).getUTCDay(); // 0 = Sunday
  return addDays(dateKey, -((weekday + 6) % 7));
}

/** A bucket key as people read it: "16 Oct", "Week of 12 Oct", "Oct 2026". */
export function bucketLabel(bucket: string, grouping: ReportGrouping): string {
  if (grouping === 'day') return shortDate(bucket);
  if (grouping === 'week') return `Week of ${shortDate(bucket)}`;
  const [y, m] = bucket.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

/** Ready-made periods, worked out from today in IST. */
export function presetPeriod(
  preset: 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisFy',
  now = new Date(),
): { from: string; to: string } {
  const today = istDateKey(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'lastMonth': {
      const end = addDays(`${today.slice(0, 8)}01`, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
    case 'thisFy': {
      const [y, m] = today.split('-').map(Number) as [number, number];
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: today };
    }
  }
}

/** Percentage change from `before` to `now`; null when there is nothing to compare with. */
export function percentChange(now: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10;
}

/** Profit as a share of the taxable value, one decimal; null for no sales. */
export function marginPercent(profit: number, taxable: number): number | null {
  return taxable > 0 ? Math.round((profit / taxable) * 1000) / 10 : null;
}

// ---------------------------------------------------------------------------
// Dashboard

/** What a period's trading came to, after returns. Money in paise. */
export interface PeriodTotals {
  bills: number;
  /** Invoiced, incl. GST. */
  grossSales: Paise;
  /** Credit notes issued in the period. */
  refunds: Paise;
  returns: number;
  /** grossSales − refunds. */
  netSales: Paise;
  /** Taxable value after returns: what profit is measured against. */
  netTaxable: Paise;
  /** GST collected after credit notes. */
  netTax: Paise;
  /** Cost of the goods sold, at the cost when sold; goods returned to the shelf come off. */
  costOfGoods: Paise;
  grossProfit: Paise;
  /** Percentage of netTaxable; null without sales. */
  margin: number | null;
  /** netSales / bills, rounded. */
  averageBill: Paise;
}

export interface DailyPoint extends PeriodTotals {
  date: string;
}

export interface DashboardDto {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  daily: DailyPoint[];
  topProducts: {
    product: { id: string; name: string; unit: Unit };
    quantity: number;
    /** After returns, incl. GST. */
    sales: Paise;
    profit: Paise;
  }[];
  payments: { method: PaymentMethod; bills: number; amount: Paise }[];
  stock: {
    costValue: Paise;
    retailValue: Paise;
    products: number;
    lowStock: number;
    outOfStock: number;
    /** The most urgent items at or below their reorder level. */
    needsRestock: {
      id: string;
      name: string;
      unit: Unit;
      stock: number;
      reorderLevel: number;
      onOrder: number;
    }[];
  };
}

// ---------------------------------------------------------------------------
// Reports: titled tables, the same shape on screen, in CSV and in PDF.

export const REPORT_KINDS = ['sales', 'products', 'gst', 'stock'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export type ReportColumnType = 'text' | 'money' | 'number' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export interface ReportSection {
  id: string;
  title: string;
  description?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** A totals row, shown last and in bold. */
  totals?: ReportRow;
  /** Shown when there are no rows. */
  empty?: string;
}

export interface ReportDto {
  kind: ReportKind;
  title: string;
  /** "1 Oct 2026 – 16 Oct 2026", or "As of 16 Oct 2026" for stock. */
  subtitle: string;
  /** Period, absent for stock (always as of now). */
  period?: { from: string; to: string };
  sections: ReportSection[];
  /** Headline figures shown above the tables. */
  highlights: { label: string; value: ReportCell; type: ReportColumnType }[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// GST set-off

export interface TaxHeads {
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

/**
 * Uses input tax credit against output tax in the order the GST rules require (section 49 and
 * rule 88A): IGST credit first against IGST, then against CGST and SGST; CGST credit against
 * CGST, then IGST; SGST credit against SGST, then IGST. CGST and SGST never cross. What is left
 * to pay goes in cash; unused credit is carried forward.
 */
export function gstSetOff(
  liability: TaxHeads,
  credit: TaxHeads,
): { payable: TaxHeads; carriedForward: TaxHeads } {
  const due = {
    cgst: Math.max(0, liability.cgst),
    sgst: Math.max(0, liability.sgst),
    igst: Math.max(0, liability.igst),
  };
  const left = {
    cgst: Math.max(0, credit.cgst),
    sgst: Math.max(0, credit.sgst),
    igst: Math.max(0, credit.igst),
  };
  const use = (from: keyof TaxHeads, against: keyof TaxHeads, cap = Infinity) => {
    const amount = Math.min(left[from], due[against], cap);
    left[from] -= amount;
    due[against] -= amount;
  };

  use('igst', 'igst');
  // What IGST credit remains is shared between CGST and SGST, then either takes the rest.
  const half = Math.floor(left.igst / 2);
  use('igst', 'cgst', half);
  use('igst', 'sgst');
  use('igst', 'cgst');
  use('cgst', 'cgst');
  use('cgst', 'igst');
  use('sgst', 'sgst');
  use('sgst', 'igst');
  return { payable: due, carriedForward: left };
}
