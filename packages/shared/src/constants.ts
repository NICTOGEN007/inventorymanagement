export const APP_NAME = 'Digital Inventory & Sales Management System';

/** Who can do what is decided by role; see docs/PLAN.md for the permission matrix. */
export const ROLES = ['admin', 'manager', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'upi'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const UNITS = ['pcs', 'kg', 'g', 'litre', 'ml', 'box', 'pack', 'dozen', 'metre'] as const;
export type Unit = (typeof UNITS)[number];

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
