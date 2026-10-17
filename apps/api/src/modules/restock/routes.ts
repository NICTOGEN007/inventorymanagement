import {
  restockPlanCreateSchema,
  restockPlanListQuerySchema,
  restockPlanUpdateSchema,
} from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { idParam } from '../../utils/query.js';
import * as restock from './service.js';

export const restockRouter = Router();
restockRouter.use(authenticate);

restockRouter.get('/alerts', requirePermission('forecast:read'), async (_req, res) => {
  res.json({ alerts: await restock.getRestockAlerts() });
});

restockRouter.get('/plans', requirePermission('forecast:read'), async (req, res) => {
  res.json(await restock.listRestockPlans(restockPlanListQuerySchema.parse(req.query)));
});

restockRouter.get('/plans/:id', requirePermission('forecast:read'), async (req, res) => {
  res.json({ plan: await restock.getRestockPlan(idParam(req)) });
});

restockRouter.post('/plans', requirePermission('purchases:manage'), async (req, res) => {
  const plan = await restock.createRestockPlan(
    restockPlanCreateSchema.parse(req.body),
    req.user!.id,
  );
  await audit(req, 'restock_plan.create', 'RestockPlan', plan.id, {
    planNumber: plan.planNumber,
    source: plan.source,
    items: plan.itemCount,
    total: plan.total,
  });
  res.status(201).json({ plan });
});

restockRouter.patch('/plans/:id', requirePermission('purchases:manage'), async (req, res) => {
  const plan = await restock.updateRestockPlan(
    idParam(req),
    restockPlanUpdateSchema.parse(req.body),
  );
  await audit(req, 'restock_plan.update', 'RestockPlan', plan.id, {
    items: plan.itemCount,
    total: plan.total,
  });
  res.json({ plan });
});

// Only a person can confirm: the assistant's tools create and edit drafts but never call this.
restockRouter.post(
  '/plans/:id/confirm',
  requirePermission('purchases:manage'),
  async (req, res) => {
    const plan = await restock.confirmRestockPlan(idParam(req), req.user!.id);
    await audit(req, 'restock_plan.confirm', 'RestockPlan', plan.id, {
      planNumber: plan.planNumber,
      purchaseOrders: plan.groups.flatMap((g) =>
        g.purchaseOrder ? [g.purchaseOrder.poNumber] : [],
      ),
      total: plan.total,
    });
    res.json({ plan });
  },
);

restockRouter.post('/plans/:id/cancel', requirePermission('purchases:manage'), async (req, res) => {
  const plan = await restock.cancelRestockPlan(idParam(req));
  await audit(req, 'restock_plan.cancel', 'RestockPlan', plan.id, { planNumber: plan.planNumber });
  res.json({ plan });
});
