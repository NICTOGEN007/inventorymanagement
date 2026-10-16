import { customerInputSchema, customerListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { idParam } from '../../utils/query.js';
import * as customers from './service.js';

export const customersRouter = Router();
customersRouter.use(authenticate);

customersRouter.get('/', requirePermission('customers:read'), async (req, res) => {
  res.json(await customers.listCustomers(customerListQuerySchema.parse(req.query)));
});

customersRouter.get('/:id', requirePermission('customers:read'), async (req, res) => {
  res.json({ customer: await customers.getCustomer(idParam(req)) });
});

customersRouter.post('/', requirePermission('customers:write'), async (req, res) => {
  const customer = await customers.createCustomer(customerInputSchema.parse(req.body));
  await audit(req, 'customer.create', 'Customer', customer.id, { name: customer.name });
  res.status(201).json({ customer });
});

customersRouter.put('/:id', requirePermission('customers:write'), async (req, res) => {
  const input = customerInputSchema.parse(req.body);
  const customer = await customers.updateCustomer(idParam(req), input);
  await audit(req, 'customer.update', 'Customer', customer.id, { changes: input });
  res.json({ customer });
});

customersRouter.delete('/:id', requirePermission('customers:write'), async (req, res) => {
  await customers.deleteCustomer(idParam(req));
  await audit(req, 'customer.delete', 'Customer', idParam(req));
  res.status(204).end();
});
