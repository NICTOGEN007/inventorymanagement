import { Router } from 'express';
import { createAuthRouter } from '../modules/auth/routes.js';
import { categoriesRouter } from '../modules/categories/routes.js';
import { inventoryRouter } from '../modules/inventory/routes.js';
import { productsRouter } from '../modules/products/routes.js';
import { suppliersRouter } from '../modules/suppliers/routes.js';
import { usersRouter } from '../modules/users/routes.js';
import { healthRouter } from './health.js';

export function createApiRouter() {
  const api = Router();
  api.use('/health', healthRouter);
  api.use('/auth', createAuthRouter());
  api.use('/users', usersRouter);
  api.use('/categories', categoriesRouter);
  api.use('/suppliers', suppliersRouter);
  api.use('/products', productsRouter);
  api.use('/inventory', inventoryRouter);
  return api;
}
