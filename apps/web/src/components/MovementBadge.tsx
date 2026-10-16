import { ADJUSTMENT_REASON_LABELS, MOVEMENT_TYPE_LABELS, type StockMovementDto } from '@ims/shared';
import { Badge, type BadgeTone } from './ui/Badge';

const TONES: Record<StockMovementDto['type'], BadgeTone> = {
  opening: 'gray',
  purchase: 'indigo',
  sale: 'gray',
  sale_return: 'green',
  purchase_return: 'amber',
  adjustment: 'amber',
};

export function MovementBadge({
  movement,
}: {
  movement: Pick<StockMovementDto, 'type' | 'reason'>;
}) {
  return (
    <Badge tone={TONES[movement.type]}>
      {movement.reason
        ? ADJUSTMENT_REASON_LABELS[movement.reason]
        : MOVEMENT_TYPE_LABELS[movement.type]}
    </Badge>
  );
}
