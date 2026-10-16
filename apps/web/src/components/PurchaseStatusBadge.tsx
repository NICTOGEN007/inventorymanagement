import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from '@ims/shared';
import { Badge, type BadgeTone } from './ui/Badge';

const TONES: Record<PurchaseOrderStatus, BadgeTone> = {
  draft: 'gray',
  ordered: 'indigo',
  partially_received: 'amber',
  received: 'green',
  closed: 'gray',
  cancelled: 'red',
};

export function PurchaseStatusBadge({
  status,
  overdue,
}: {
  status: PurchaseOrderStatus;
  overdue?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={TONES[status]}>{PURCHASE_ORDER_STATUS_LABELS[status]}</Badge>
      {overdue && <Badge tone="red">Overdue</Badge>}
    </span>
  );
}
