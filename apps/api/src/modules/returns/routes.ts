import { saleReturnInputSchema, saleReturnListQuerySchema } from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import { idParam } from '../../utils/query.js';
import { getShopSettings } from '../settings/service.js';
import { renderCreditNotePdf } from './credit-note-pdf.js';
import * as returns from './service.js';

export const returnsRouter = Router();
returnsRouter.use(authenticate);

returnsRouter.get('/', requirePermission('sales:read'), async (req, res) => {
  res.json(await returns.listReturns(saleReturnListQuerySchema.parse(req.query)));
});

returnsRouter.get('/:id', requirePermission('sales:read'), async (req, res) => {
  res.json({ saleReturn: await returns.getReturn(idParam(req)) });
});

returnsRouter.get('/:id/credit-note.pdf', requirePermission('sales:read'), async (req, res) => {
  const saleReturn = await returns.getReturn(idParam(req));
  const pdf = await renderCreditNotePdf(saleReturn, await getShopSettings());
  res
    .type('application/pdf')
    .set(
      'Content-Disposition',
      `inline; filename="${saleReturn.returnNumber.replaceAll('/', '-')}.pdf"`,
    )
    .set('Cache-Control', 'private, no-store')
    .send(pdf);
});

returnsRouter.post('/', requirePermission('returns:create'), async (req, res) => {
  const input = saleReturnInputSchema.parse(req.body);
  const { saleReturn, created } = await returns.createReturn(input, req.user!.id);
  if (!created) return void res.json({ saleReturn });
  await audit(req, 'return.create', 'SaleReturn', saleReturn.id, {
    returnNumber: saleReturn.returnNumber,
    invoiceNumber: saleReturn.sale.invoiceNumber,
    totalRefund: saleReturn.totalRefund,
    items: saleReturn.items.map((i) => ({
      product: i.product.id,
      quantity: i.quantity,
      restock: i.restock,
    })),
  });
  res.status(201).json({ saleReturn });
});
