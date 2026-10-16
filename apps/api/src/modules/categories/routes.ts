import { categoryInputSchema, categoryUpdateSchema } from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { idParam } from '../../utils/query.js';
import * as categories from './service.js';

export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

categoriesRouter.get('/', requirePermission('products:read'), async (_req, res) => {
  res.json({ data: await categories.listCategories() });
});

categoriesRouter.post('/', requirePermission('products:write'), async (req, res) => {
  const category = await categories.createCategory(categoryInputSchema.parse(req.body));
  await audit(req, 'category.create', 'Category', category.id, { name: category.name });
  res.status(201).json({ category });
});

categoriesRouter.patch('/:id', requirePermission('products:write'), async (req, res) => {
  const input = categoryUpdateSchema.parse(req.body);
  const category = await categories.updateCategory(idParam(req), input);
  await audit(req, 'category.update', 'Category', category.id, { changes: input });
  res.json({ category });
});

categoriesRouter.delete('/:id', requirePermission('products:write'), async (req, res) => {
  await categories.deleteCategory(idParam(req));
  await audit(req, 'category.delete', 'Category', idParam(req));
  res.status(204).end();
});
