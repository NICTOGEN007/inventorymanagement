import { Router } from 'express';
import { createAuthRouter } from '../modules/auth/routes.js';
import { usersRouter } from '../modules/users/routes.js';
import { healthRouter } from './health.js';

export function createApiRouter() {
  const api = Router();
  api.use('/health', healthRouter);
  api.use('/auth', createAuthRouter());
  api.use('/users', usersRouter);
  return api;
}
