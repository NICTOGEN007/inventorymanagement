import type { Permission } from '@ims/shared';

export const INVENTORY_TABS: { to: string; label: string; permission: Permission }[] = [
  { to: '/inventory', label: 'Overview', permission: 'inventory:read' },
  { to: '/inventory/movements', label: 'Stock history', permission: 'inventory:read' },
  { to: '/inventory/adjust', label: 'Adjust stock', permission: 'inventory:adjust' },
];
