import {
  cancelPurchaseOrderSchema,
  purchaseOrderInputSchema,
  purchaseOrderListQuerySchema,
  receiveGoodsSchema,
} from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { idParam } from '../../utils/query.js';
import * as orders from './service.js';

export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(authenticate);

purchaseOrdersRouter.get('/', requirePermission('purchases:read'), async (req, res) => {
  res.json(await orders.listPurchaseOrders(purchaseOrderListQuerySchema.parse(req.query)));
});

purchaseOrdersRouter.get('/:id', requirePermission('purchases:read'), async (req, res) => {
  res.json({ purchaseOrder: await orders.getPurchaseOrder(idParam(req)) });
});

purchaseOrdersRouter.post('/', requirePermission('purchases:manage'), async (req, res) => {
  const input = purchaseOrderInputSchema.parse(req.body);
  const po = await orders.createPurchaseOrder(input, req.user!.id);
  await audit(req, 'purchase_order.create', 'PurchaseOrder', po.id, {
    poNumber: po.poNumber,
    status: po.status,
    total: po.total,
  });
  res.status(201).json({ purchaseOrder: po });
});

purchaseOrdersRouter.put('/:id', requirePermission('purchases:manage'), async (req, res) => {
  const po = await orders.updateDraft(idParam(req), purchaseOrderInputSchema.parse(req.body));
  await audit(req, 'purchase_order.update', 'PurchaseOrder', po.id, {
    status: po.status,
    total: po.total,
  });
  res.json({ purchaseOrder: po });
});

purchaseOrdersRouter.post('/:id/place', requirePermission('purchases:manage'), async (req, res) => {
  const po = await orders.placeOrder(idParam(req));
  await audit(req, 'purchase_order.place', 'PurchaseOrder', po.id, { poNumber: po.poNumber });
  res.json({ purchaseOrder: po });
});

purchaseOrdersRouter.post(
  '/:id/receive',
  requirePermission('purchases:manage'),
  async (req, res) => {
    const input = receiveGoodsSchema.parse(req.body);
    const po = await orders.receiveGoods(idParam(req), input, req.user!.id);
    await audit(req, 'purchase_order.receive', 'PurchaseOrder', po.id, {
      supplierInvoiceNumber: input.supplierInvoiceNumber,
      items: input.items,
      status: po.status,
    });
    res.json({ purchaseOrder: po });
  },
);

purchaseOrdersRouter.post(
  '/:id/cancel',
  requirePermission('purchases:manage'),
  async (req, res) => {
    const { reason } = cancelPurchaseOrderSchema.parse(req.body);
    const po = await orders.cancelPurchaseOrder(idParam(req), reason);
    await audit(req, 'purchase_order.cancel', 'PurchaseOrder', po.id, {
      reason,
      status: po.status,
    });
    res.json({ purchaseOrder: po });
  },
);
