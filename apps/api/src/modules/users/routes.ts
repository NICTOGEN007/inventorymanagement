import { createUserSchema, resetPasswordSchema, ROLES, updateUserSchema } from '@ims/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import * as users from './service.js';

const listQuerySchema = z.object({
  search: z.string().max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const usersRouter = Router();

usersRouter.use(authenticate, requirePermission('users:manage'));

usersRouter.get('/', async (req, res) => {
  res.json({ data: await users.listUsers(listQuerySchema.parse(req.query)) });
});

usersRouter.post('/', async (req, res) => {
  const user = await users.createUser(createUserSchema.parse(req.body));
  await audit(req, 'user.create', 'User', user.id, { email: user.email, role: user.role });
  res.status(201).json({ user });
});

usersRouter.get('/:id', async (req, res) => {
  res.json({ user: await users.getUser(req.params.id) });
});

usersRouter.patch('/:id', async (req, res) => {
  const input = updateUserSchema.parse(req.body);
  const user = await users.updateUser(req.user!.id, req.params.id, input);
  await audit(req, 'user.update', 'User', user.id, { changes: input });
  res.json({ user });
});

usersRouter.post('/:id/reset-password', async (req, res) => {
  const { password } = resetPasswordSchema.parse(req.body);
  const user = await users.resetPassword(req.params.id, password);
  await audit(req, 'user.reset_password', 'User', user.id);
  res.json({ user });
});
