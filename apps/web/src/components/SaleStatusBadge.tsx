import { SALE_STATUS_LABELS, type SaleStatus } from '@ims/shared';
import { Badge, type BadgeTone } from './ui/Badge';

const TONES: Record<SaleStatus, BadgeTone> = {
  completed: 'green',
  partially_returned: 'amber',
  returned: 'gray',
  cancelled: 'red',
};

/** Nothing for an ordinary completed sale; a badge once goods come back. */
export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  if (status === 'completed') return null;
  return <Badge tone={TONES[status]}>{SALE_STATUS_LABELS[status]}</Badge>;
}
