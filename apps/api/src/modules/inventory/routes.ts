import { can, movementListQuerySchema, stockAdjustmentSchema } from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import * as inventory from './service.js';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

inventoryRouter.get('/movements', requirePermission('inventory:read'), async (req, res) => {
  const query = movementListQuerySchema.parse(req.query);
  res.json(
    await inventory.listMovements(query, { includeCost: can(req.user!.role, 'reports:read') }),
  );
});

inventoryRouter.get('/summary', requirePermission('reports:read'), async (_req, res) => {
  res.json(await inventory.inventorySummary());
});

inventoryRouter.post('/adjustments', requirePermission('inventory:adjust'), async (req, res) => {
  const input = stockAdjustmentSchema.parse(req.body);
  const result = await inventory.adjustStock(input, req.user!.id);
  await audit(req, 'inventory.adjust', 'StockMovement', undefined, {
    reason: input.reason,
    note: input.note,
    adjusted: result.adjusted.map((a) => ({ product: a.product.id, change: a.change })),
  });
  res.status(201).json(result);
});
