import { productCreateSchema, productListQuerySchema, productUpdateSchema } from '@ims/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { idParam } from '../../utils/query.js';
import * as products from './service.js';

export const productsRouter = Router();
productsRouter.use(authenticate);

productsRouter.get('/', requirePermission('products:read'), async (req, res) => {
  res.json(await products.listProducts(productListQuerySchema.parse(req.query)));
});

productsRouter.get('/lookup', requirePermission('products:read'), async (req, res) => {
  const { code } = z.object({ code: z.string().trim().min(1).max(32) }).parse(req.query);
  res.json({ product: await products.lookupProduct(code) });
});

productsRouter.get('/:id', requirePermission('products:read'), async (req, res) => {
  res.json({ product: await products.getProduct(idParam(req)) });
});

productsRouter.post('/', requirePermission('products:write'), async (req, res) => {
  const input = productCreateSchema.parse(req.body);
  const product = await products.createProduct(input, req.user!.id);
  await audit(req, 'product.create', 'Product', product.id, {
    sku: product.sku,
    openingStock: input.openingStock,
  });
  res.status(201).json({ product });
});

productsRouter.patch('/:id', requirePermission('products:write'), async (req, res) => {
  // Keep explicit "remove this" fields (sent as null or "") visible to the service.
  const body = Object.fromEntries(
    Object.entries(req.body ?? {}).map(([k, v]) => [k, v === null ? '' : v]),
  );
  const input = productUpdateSchema.parse(body);
  const keys = Object.keys(body);
  const withRemovals = Object.fromEntries(keys.map((k) => [k, input[k as keyof typeof input]]));
  const { product, priceChanges } = await products.updateProduct(idParam(req), withRemovals);
  await audit(req, 'product.update', 'Product', product.id, {
    fields: keys,
    ...(Object.keys(priceChanges).length > 0 && { priceChanges }),
  });
  res.json({ product });
});
