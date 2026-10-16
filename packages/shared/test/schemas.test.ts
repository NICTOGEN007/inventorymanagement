import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema, passwordSchema } from '../src/schemas/auth.js';
import { createUserSchema, updateUserSchema } from '../src/schemas/users.js';

describe('auth schemas', () => {
  it('normalises the email on login', () => {
    expect(loginSchema.parse({ email: '  Admin@Example.COM ', password: 'x' }).email).toBe(
      'admin@example.com',
    );
  });

  it('rejects malformed emails and empty passwords', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  it('enforces password strength', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('lettersonly').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('Shop2026').success).toBe(true);
    // 72-byte bcrypt limit counts bytes, not characters.
    expect(passwordSchema.safeParse('a1' + '₹'.repeat(23)).success).toBe(true); // 71 bytes
    expect(passwordSchema.safeParse('a1' + '₹'.repeat(24)).success).toBe(false); // 74 bytes
  });

  it('requires a new password different from the current one', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'Shop2026',
      newPassword: 'Shop2026',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['newPassword']);
  });
});

describe('user schemas', () => {
  it('validates new users', () => {
    const ok = createUserSchema.safeParse({
      name: ' Priya Nair ',
      email: 'priya@example.com',
      role: 'cashier',
      password: 'Cashier2026',
    });
    expect(ok.success && ok.data.name).toBe('Priya Nair');
    const bad = createUserSchema.safeParse({ name: 'P', email: 'x', role: 'owner', password: '1' });
    expect(new Set(bad.error?.issues.map((i) => i.path[0]))).toEqual(
      new Set(['name', 'email', 'role', 'password']),
    );
  });

  it('accepts partial updates but not empty ones', () => {
    expect(updateUserSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });
});
