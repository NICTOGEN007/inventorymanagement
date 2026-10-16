import {
  allowsFractions,
  calculateReturnTotals,
  financialYear,
  formatDocumentNumber,
  istDayRange,
  returnableQuantity,
  returnLineAmounts,
  type GstRate,
  type PaymentMethod,
  type SaleReturnDto,
  type SaleReturnInput,
  type SaleReturnList,
  type SaleReturnListQuery,
  type SaleReturnSummaryDto,
  type StateCode,
  type Unit,
} from '@ims/shared';
import mongoose, { type Types } from 'mongoose';
import {
  nextSequence,
  ProductModel,
  SaleModel,
  SaleReturnModel,
  type SaleReturn,
} from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { containsPattern, iso, toObjectId } from '../../utils/query.js';
import { recordMovement, round3 } from '../inventory/ledger.js';
import { cashierNames, customerOf } from '../sales/service.js';
import { getShopSettings } from '../settings/service.js';

type ReturnDoc = SaleReturn & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const fieldError = (path: (string | number)[], message: string) =>
  AppError.badRequest(message, [{ path, message }]);

const isDuplicateClientRef = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: number }).code === 11000 &&
  'clientRef' in ((err as { keyPattern?: object }).keyPattern ?? {});

/**
 * Takes goods back against an invoice and issues a credit note. Each line refunds its share of
 * what the customer paid for it; goods in sellable condition go back into stock at the cost they
 * left at. The sale, the credit note and the stock move together in one transaction, so two
 * returns of the same bill at once can never take back more than was sold.
 */
export async function createReturn(
  input: SaleReturnInput,
  userId: string,
): Promise<{ saleReturn: SaleReturnDto; created: boolean }> {
  const replay = async () => {
    if (!input.clientRef) return undefined;
    const existing = await SaleReturnModel.findOne({ clientRef: input.clientRef }, { _id: 1 });
    return existing
      ? { saleReturn: await getReturn(String(existing._id)), created: false }
      : undefined;
  };
  const earlier = await replay();
  if (earlier) return earlier;

  let id: Types.ObjectId;
  try {
    id = await mongoose.connection.transaction(async (session) => {
      const sale = await SaleModel.findById(toObjectId(input.sale, 'Sale not found'), null, {
        session,
      });
      if (!sale) throw AppError.notFound('Sale not found');
      if (sale.status === 'cancelled') throw AppError.conflict('This sale was cancelled');

      const lines = input.items.map((item, index) => {
        const line = sale.items.find((l) => String(l.product) === item.product);
        if (!line) {
          throw fieldError(['items', index, 'product'], 'This product is not on the invoice');
        }
        const remaining = returnableQuantity(line);
        if (remaining <= 0) {
          throw fieldError(['items', index, 'quantity'], `${line.name} was already returned`);
        }
        if (item.quantity > remaining + 1e-9) {
          throw fieldError(
            ['items', index, 'quantity'],
            `Only ${remaining} ${line.unit} of ${line.name} can still be returned`,
          );
        }
        if (!allowsFractions(line.unit as Unit) && !Number.isInteger(item.quantity)) {
          throw fieldError(
            ['items', index, 'quantity'],
            `${line.name} is returned in whole ${line.unit}`,
          );
        }
        const refunded = {
          taxable: line.refunded?.taxable ?? 0,
          cgst: line.refunded?.cgst ?? 0,
          sgst: line.refunded?.sgst ?? 0,
          igst: line.refunded?.igst ?? 0,
        };
        const amounts = returnLineAmounts({ ...line.toObject(), refunded }, item.quantity);
        return { item, line, refunded, amounts };
      });

      const returnedAfter = new Map(lines.map((l) => [l.line, l.item.quantity]));
      const completesSale = sale.items.every(
        (l) => returnableQuantity(l) - (returnedAfter.get(l) ?? 0) <= 1e-9,
      );
      const totals = calculateReturnTotals(
        lines.map((l) => l.amounts),
        { grandTotal: sale.grandTotal, refundedTotal: sale.refundedTotal ?? 0 },
        completesSale,
      );

      const settings = await getShopSettings(session);
      const now = new Date();
      const seq = await nextSequence(`return:${financialYear(now)}`, session);
      const customer = customerOf(sale);
      const [saleReturn] = await SaleReturnModel.create(
        [
          {
            returnNumber: formatDocumentNumber(settings.returnPrefix, now, seq),
            sale: sale._id,
            invoiceNumber: sale.invoiceNumber,
            ...(sale.customer && { customer: sale.customer }),
            ...(customer && { customerName: customer.name }),
            placeOfSupply: sale.placeOfSupply,
            interState: sale.interState,
            items: lines.map(({ item, line, amounts }) => ({
              product: line.product,
              name: line.name,
              sku: line.sku,
              hsnCode: line.hsnCode,
              unit: line.unit,
              gstRate: line.gstRate,
              quantity: item.quantity,
              unitCost: line.unitCost,
              ...amounts,
              restock: item.restock,
            })),
            ...totals,
            refundMethod: input.refundMethod,
            refundReference: input.refundReference,
            reason: input.reason,
            processedBy: userId,
            returnedAt: now,
            clientRef: input.clientRef,
          },
        ],
        { session },
      );

      for (const { line, refunded, amounts, item } of lines) {
        line.returnedQuantity = round3(line.returnedQuantity + item.quantity);
        line.refunded = {
          taxable: refunded.taxable + amounts.taxable,
          cgst: refunded.cgst + amounts.cgst,
          sgst: refunded.sgst + amounts.sgst,
          igst: refunded.igst + amounts.igst,
        };
      }
      sale.refundedTotal = (sale.refundedTotal ?? 0) + totals.totalRefund;
      sale.status = completesSale ? 'returned' : 'partially_returned';
      await sale.save({ session });

      for (const [index, { item, line }] of lines.entries()) {
        if (!item.restock) continue;
        const before = await ProductModel.findById(
          line.product,
          { stock: 1, costPrice: 1 },
          { session },
        ).lean();
        if (!before) {
          throw fieldError(
            ['items', index, 'restock'],
            `${line.name} is no longer in the catalogue, so it cannot go back into stock`,
          );
        }
        await recordMovement(
          {
            product: line.product,
            type: 'sale_return',
            quantity: item.quantity,
            unitCost: line.unitCost,
            ref: { model: 'SaleReturn', id: saleReturn!._id },
            userId,
            occurredAt: now,
            note: input.reason,
          },
          session,
        );
        // Goods come back at the cost they left at, so the average cost stays true.
        const stockBefore = Math.max(0, before.stock);
        const costPrice =
          stockBefore > 0
            ? Math.round(
                (stockBefore * before.costPrice + item.quantity * line.unitCost) /
                  (stockBefore + item.quantity),
              )
            : line.unitCost;
        if (costPrice !== before.costPrice) {
          await ProductModel.updateOne({ _id: line.product }, { $set: { costPrice } }, { session });
        }
      }
      return saleReturn!._id;
    });
  } catch (err) {
    if (isDuplicateClientRef(err)) {
      const first = await replay();
      if (first) return first;
    }
    throw err;
  }
  return { saleReturn: await getReturn(String(id)), created: true };
}

function toSummary(
  r: ReturnDoc,
  processedBy: string,
  sale?: Parameters<typeof customerOf>[0],
): SaleReturnSummaryDto {
  const fromSale = sale && customerOf(sale);
  const customer =
    fromSale ??
    (r.customerName
      ? { ...(r.customer && { id: String(r.customer) }), name: r.customerName }
      : undefined);
  return {
    id: String(r._id),
    returnNumber: r.returnNumber,
    returnedAt: iso(r.returnedAt),
    sale: { id: String(r.sale), invoiceNumber: r.invoiceNumber },
    ...(customer && { customer }),
    itemCount: r.items.length,
    totalRefund: r.totalRefund,
    refundMethod: r.refundMethod as PaymentMethod,
    reason: r.reason,
    processedBy: { id: String(r.processedBy), name: processedBy },
  };
}

function listFilter(query: SaleReturnListQuery) {
  const filter: mongoose.QueryFilter<Record<string, unknown>> = {};
  if (query.from || query.to) {
    filter.returnedAt = {
      ...(query.from && { $gte: istDayRange(query.from).start }),
      ...(query.to && { $lt: istDayRange(query.to).end }),
    };
  }
  if (query.search) {
    const pattern = containsPattern(query.search);
    filter.$or = [{ returnNumber: pattern }, { invoiceNumber: pattern }, { customerName: pattern }];
  }
  if (query.customer) filter.customer = toObjectId(query.customer);
  if (query.sale) filter.sale = toObjectId(query.sale);
  return filter;
}

export async function listReturns(query: SaleReturnListQuery): Promise<SaleReturnList> {
  const filter = listFilter(query);
  const [returns, totals] = await Promise.all([
    SaleReturnModel.find(filter)
      .sort({ returnedAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<ReturnDoc[]>(),
    SaleReturnModel.aggregate<{ count: number; total: number }>([
      { $match: filter },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$totalRefund' } } },
    ]),
  ]);
  const names = await cashierNames(returns.map((r) => r.processedBy));
  const summary = { count: totals[0]?.count ?? 0, total: totals[0]?.total ?? 0 };
  return {
    data: returns.map((r) => toSummary(r, names.get(String(r.processedBy)) ?? 'Unknown')),
    page: query.page,
    pageSize: query.pageSize,
    total: summary.count,
    summary,
  };
}

export async function getReturn(id: string): Promise<SaleReturnDto> {
  const r = await SaleReturnModel.findById(toObjectId(id, 'Return not found')).lean<ReturnDoc>();
  if (!r) throw AppError.notFound('Return not found');
  const [names, sale] = await Promise.all([
    cashierNames([r.processedBy]),
    SaleModel.findById(r.sale, { soldAt: 1, customer: 1, customerSnapshot: 1 }).lean(),
  ]);
  return {
    ...toSummary(r, names.get(String(r.processedBy)) ?? 'Unknown', sale ?? undefined),
    soldAt: iso(sale?.soldAt ?? r.returnedAt),
    placeOfSupply: r.placeOfSupply as StateCode,
    interState: r.interState,
    items: r.items.map((i) => ({
      product: { id: String(i.product), name: i.name, sku: i.sku, unit: i.unit as Unit },
      hsnCode: i.hsnCode,
      gstRate: i.gstRate as GstRate,
      quantity: i.quantity,
      taxable: i.taxable,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      total: i.total,
      restock: i.restock ?? true,
    })),
    taxable: r.taxable,
    cgst: r.cgst,
    sgst: r.sgst,
    igst: r.igst,
    totalTax: r.totalTax ?? r.cgst + r.sgst + r.igst,
    roundOff: r.roundOff ?? 0,
    ...(r.refundReference && { refundReference: r.refundReference }),
  };
}
