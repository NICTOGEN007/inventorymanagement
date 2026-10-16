import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

/** UTF-8 length in bytes (₹ is 3 bytes, most emoji 4). */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** bcrypt only uses the first 72 bytes of a password, so longer ones are rejected. */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => utf8Length(p) <= 72, 'Password is too long')
  .refine(
    (p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p),
    'Password must contain a letter and a number',
  );

export const loginSchema = z.object({
  email: emailSchema,
  // No strength rules on login: just check what was typed.
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must be different',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
