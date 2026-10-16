import { customerListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import * as customers from './service.js';

export const customersRouter = Router();
customersRouter.use(authenticate);

customersRouter.get('/', requirePermission('customers:read'), async (req, res) => {
  res.json(await customers.listCustomers(customerListQuerySchema.parse(req.query)));
});
