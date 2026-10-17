import { Router } from 'express';
import { createAuthRouter } from '../modules/auth/routes.js';
import { categoriesRouter } from '../modules/categories/routes.js';
import { customersRouter } from '../modules/customers/routes.js';
import { forecastRouter } from '../modules/forecasting/routes.js';
import { inventoryRouter } from '../modules/inventory/routes.js';
import { productsRouter } from '../modules/products/routes.js';
import { purchaseOrdersRouter } from '../modules/purchase-orders/routes.js';
import { reportsRouter } from '../modules/reports/routes.js';
import { restockRouter } from '../modules/restock/routes.js';
import { returnsRouter } from '../modules/returns/routes.js';
import { salesRouter } from '../modules/sales/routes.js';
import { settingsRouter } from '../modules/settings/routes.js';
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
  api.use('/purchase-orders', purchaseOrdersRouter);
  api.use('/sales', salesRouter);
  api.use('/returns', returnsRouter);
  api.use('/reports', reportsRouter);
  api.use('/forecast', forecastRouter);
  api.use('/restock', restockRouter);
  api.use('/customers', customersRouter);
  api.use('/settings', settingsRouter);
  return api;
}
