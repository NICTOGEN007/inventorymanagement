import { z } from 'zod';
import { ROLES } from '../constants.js';
import { emailSchema, passwordSchema } from './auth.js';

const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters').max(100);

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(ROLES),
  password: passwordSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: nameSchema,
    role: z.enum(ROLES),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
