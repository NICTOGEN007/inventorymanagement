import type { RestockPlanStatus, RestockStatus } from '@ims/shared';
import { Badge, type BadgeTone } from './ui/Badge';

const STATUS: Record<RestockStatus, { label: string; tone: BadgeTone }> = {
  reorder: { label: 'Reorder now', tone: 'red' },
  watch: { label: 'Order soon', tone: 'amber' },
  ordered: { label: 'On order', tone: 'indigo' },
  ok: { label: 'Enough stock', tone: 'green' },
  dead: { label: 'Not selling', tone: 'gray' },
  new: { label: 'No sales yet', tone: 'gray' },
};

export const RESTOCK_STATUS_LABELS = Object.fromEntries(
  Object.entries(STATUS).map(([k, v]) => [k, v.label]),
) as Record<RestockStatus, string>;

export function RestockStatusBadge({ status }: { status: RestockStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

const PLAN: Record<RestockPlanStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Waiting for review', tone: 'indigo' },
  confirmed: { label: 'Confirmed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
  expired: { label: 'Expired', tone: 'amber' },
};

export function PlanStatusBadge({ status }: { status: RestockPlanStatus }) {
  return <Badge tone={PLAN[status].tone}>{PLAN[status].label}</Badge>;
}

/** How long stock lasts, in words: "Out of stock", "Runs out today", "3 days", "120+ days". */
export function lastsLabel(days: number | null, stock: number): string {
  if (stock <= 0) return 'Out of stock';
  if (days === null) return '120+ days';
  if (days === 0) return 'Runs out today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Daily demand with sensible precision: "12", "3.4", "0.4". */
export function formatRate(value: number): string {
  return value >= 10
    ? Math.round(value).toLocaleString('en-IN')
    : (Math.round(value * 10) / 10).toLocaleString('en-IN');
}
