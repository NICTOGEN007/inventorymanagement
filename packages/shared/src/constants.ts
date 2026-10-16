export const APP_NAME = 'Digital Inventory & Sales Management System';

/** Who can do what is decided by role; see docs/PLAN.md for the permission matrix. */
export const ROLES = ['admin', 'manager', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'upi'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const UNITS = ['pcs', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'dozen', 'metre'] as const;
export type Unit = (typeof UNITS)[number];

/** Units that can be sold or counted in fractions (2.5 kg); all others are whole numbers only. */
export const FRACTIONAL_UNITS: readonly Unit[] = ['kg', 'g', 'litre', 'ml', 'metre'];

export function allowsFractions(unit: Unit): boolean {
  return FRACTIONAL_UNITS.includes(unit);
}

/** Every change to stock is recorded as one of these movement types. */
export const STOCK_MOVEMENT_TYPES = [
  'purchase',
  'sale',
  'sale_return',
  'purchase_return',
  'adjustment',
  'opening',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** Why stock was adjusted by hand. Every adjustment needs one. */
export const ADJUSTMENT_REASONS = ['count', 'damaged', 'expired', 'lost', 'other'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABELS: Readonly<Record<AdjustmentReason, string>> = {
  count: 'Stock count correction',
  damaged: 'Damaged',
  expired: 'Expired',
  lost: 'Lost or stolen',
  other: 'Other',
};

/** Reasons that can only reduce stock. */
export const REDUCING_REASONS: readonly AdjustmentReason[] = ['damaged', 'expired', 'lost'];

export const MOVEMENT_TYPE_LABELS: Readonly<Record<StockMovementType, string>> = {
  opening: 'Opening stock',
  purchase: 'Purchase received',
  sale: 'Sale',
  sale_return: 'Customer return',
  purchase_return: 'Returned to supplier',
  adjustment: 'Adjustment',
};

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_STATUS_LABELS: Readonly<Record<PurchaseOrderStatus, string>> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partially_received: 'Partly received',
  received: 'Received',
  closed: 'Closed short',
  cancelled: 'Cancelled',
};

/** Orders still expecting goods. */
export const OPEN_PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  'ordered',
  'partially_received',
];
