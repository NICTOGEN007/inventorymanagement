import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, ROLE_PERMISSIONS } from '../src/permissions.js';

describe('permissions', () => {
  it('gives admins everything', () => {
    for (const p of PERMISSIONS) expect(can('admin', p)).toBe(true);
  });

  it('keeps user, settings and audit management admin-only', () => {
    for (const p of ['users:manage', 'settings:manage', 'audit:read'] as const) {
      expect(can('manager', p)).toBe(false);
      expect(can('cashier', p)).toBe(false);
    }
  });

  it('lets managers run the store', () => {
    expect(can('manager', 'products:write')).toBe(true);
    expect(can('manager', 'inventory:adjust')).toBe(true);
    expect(can('manager', 'reports:read')).toBe(true);
    expect(can('manager', 'assistant:use')).toBe(true);
  });

  it('limits cashiers to billing', () => {
    expect(can('cashier', 'sales:create')).toBe(true);
    expect(can('cashier', 'returns:create')).toBe(true);
    expect(can('cashier', 'products:write')).toBe(false);
    expect(can('cashier', 'reports:read')).toBe(false);
    expect(can('cashier', 'inventory:adjust')).toBe(false);
  });

  it('denies an unknown user', () => {
    expect(can(undefined, 'sales:read')).toBe(false);
  });

  it('gives each role a subset of the admin permissions', () => {
    for (const set of Object.values(ROLE_PERMISSIONS)) {
      for (const p of set) expect(PERMISSIONS).toContain(p);
    }
  });
});
