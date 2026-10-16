import type { Role } from './constants.js';

/**
 * Everything a user can be allowed to do. The API enforces these on every route;
 * the web app uses the same list to hide what a user cannot use.
 */
export const PERMISSIONS = [
  'users:manage',
  'settings:manage',
  'audit:read',
  'products:read',
  'products:write',
  'inventory:read',
  'inventory:adjust',
  'purchases:read',
  'purchases:manage',
  'sales:create',
  'sales:read',
  'returns:create',
  'customers:read',
  'customers:write',
  'reports:read',
  'forecast:read',
  'assistant:use',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: readonly Permission[] = PERMISSIONS.filter(
  (p) => !['users:manage', 'settings:manage', 'audit:read'].includes(p),
);

const CASHIER: readonly Permission[] = [
  'products:read',
  'inventory:read',
  'sales:create',
  'sales:read',
  'returns:create',
  'customers:read',
  'customers:write',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  admin: new Set(PERMISSIONS),
  manager: new Set(MANAGER),
  cashier: new Set(CASHIER),
};

export function can(role: Role | undefined, permission: Permission): boolean {
  return role !== undefined && ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: 'Admin',
  manager: 'Manager',
  cashier: 'Cashier',
};
