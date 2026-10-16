import type { StockStatus } from '@ims/shared';
import { Badge } from './ui/Badge';

const LABELS: Record<StockStatus, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  ok: { label: 'In stock', tone: 'green' },
  low: { label: 'Low stock', tone: 'amber' },
  out: { label: 'Out of stock', tone: 'red' },
};

export function StockBadge({ status }: { status: StockStatus }) {
  return <Badge tone={LABELS[status].tone}>{LABELS[status].label}</Badge>;
}
