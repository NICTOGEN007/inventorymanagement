import { supplierInputSchema } from '@ims/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { idParam } from '../../utils/query.js';
import * as suppliers from './service.js';

export const suppliersRouter = Router();
suppliersRouter.use(authenticate);

suppliersRouter.get('/', requirePermission('purchases:read'), async (req, res) => {
  const { search } = z.object({ search: z.string().trim().max(100).optional() }).parse(req.query);
  res.json({ data: await suppliers.listSuppliers(search) });
});

suppliersRouter.get('/:id', requirePermission('purchases:read'), async (req, res) => {
  res.json({ supplier: await suppliers.getSupplier(idParam(req)) });
});

suppliersRouter.post('/', requirePermission('purchases:manage'), async (req, res) => {
  const supplier = await suppliers.createSupplier(supplierInputSchema.parse(req.body));
  await audit(req, 'supplier.create', 'Supplier', supplier.id, { name: supplier.name });
  res.status(201).json({ supplier });
});

suppliersRouter.put('/:id', requirePermission('purchases:manage'), async (req, res) => {
  const input = supplierInputSchema.parse(req.body);
  const supplier = await suppliers.updateSupplier(idParam(req), input);
  await audit(req, 'supplier.update', 'Supplier', supplier.id, { changes: input });
  res.json({ supplier });
});

suppliersRouter.delete('/:id', requirePermission('purchases:manage'), async (req, res) => {
  await suppliers.deleteSupplier(idParam(req));
  await audit(req, 'supplier.delete', 'Supplier', idParam(req));
  res.status(204).end();
});
