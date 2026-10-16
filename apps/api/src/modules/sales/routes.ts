import { saleInputSchema, saleListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { idParam } from '../../utils/query.js';
import { getShopSettings } from '../settings/service.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import * as sales from './service.js';

export const salesRouter = Router();
salesRouter.use(authenticate);

salesRouter.get('/', requirePermission('sales:read'), async (req, res) => {
  res.json(await sales.listSales(saleListQuerySchema.parse(req.query)));
});

salesRouter.get('/:id', requirePermission('sales:read'), async (req, res) => {
  res.json({ sale: await sales.getSale(idParam(req)) });
});

salesRouter.get('/:id/invoice.pdf', requirePermission('sales:read'), async (req, res) => {
  const sale = await sales.getSale(idParam(req));
  const pdf = await renderInvoicePdf(sale, await getShopSettings());
  res
    .type('application/pdf')
    .set('Content-Disposition', `inline; filename="${sale.invoiceNumber.replaceAll('/', '-')}.pdf"`)
    .set('Cache-Control', 'private, no-store')
    .send(pdf);
});

salesRouter.post('/', requirePermission('sales:create'), async (req, res) => {
  const input = saleInputSchema.parse(req.body);
  const { sale, created } = await sales.createSale(input, req.user!.id);
  // A resent bill answers with the invoice already issued for it.
  if (!created) return void res.json({ sale });
  await audit(req, 'sale.create', 'Sale', sale.id, {
    invoiceNumber: sale.invoiceNumber,
    grandTotal: sale.grandTotal,
    items: sale.items.length,
  });
  res.status(201).json({ sale });
});
