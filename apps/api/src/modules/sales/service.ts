import {
  allowsFractions,
  calculateInvoiceTotals,
  calculateLine,
  financialYear,
  formatDocumentNumber,
  formatINR,
  istDayRange,
  type GstRate,
  type PaymentMethod,
  type SaleDto,
  type SaleInput,
  type SaleList,
  type SaleListQuery,
  type SaleSummaryDto,
  type StateCode,
  type Unit,
} from '@ims/shared';
import mongoose, { type ClientSession, type Types } from 'mongoose';
import {
  CustomerModel,
  nextSequence,
  ProductModel,
  SaleModel,
  UserModel,
  type Sale,
} from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { containsPattern, iso, toObjectId } from '../../utils/query.js';
import { recordMovement } from '../inventory/ledger.js';
import { getShopSettings } from '../settings/service.js';

type SaleDoc = Sale & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

/** 400 with the field at fault; 409 INSUFFICIENT_STOCK when a line asks for more than is left. */
const fieldError = (path: (string | number)[], message: string, status: 400 | 409 = 400) =>
  status === 409
    ? new AppError(409, message, 'INSUFFICIENT_STOCK', [{ path, message }])
    : AppError.badRequest(message, [{ path, message }]);

async function activeCustomer(id: string, session: ClientSession) {
  const customer = await CustomerModel.findById(toObjectId(id, 'Customer not found'), null, {
    session,
  }).lean();
  if (!customer) throw fieldError(['customer'], 'Customer not found');
  if (customer.isActive === false) throw fieldError(['customer'], `${customer.name} is inactive`);
  return customer;
}

/**
 * Prices each line from the product's current selling price and works out GST, CGST + SGST for
 * a sale within the shop's state and IGST for a customer registered in another state.
 */
async function priceItems(items: SaleInput['items'], interState: boolean, session: ClientSession) {
  const products = await ProductModel.find(
    { _id: { $in: items.map((i) => toObjectId(i.product)) } },
    null,
    { session },
  ).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  return items.map((item, index) => {
    const product = byId.get(item.product);
    if (!product) throw fieldError(['items', index, 'product'], 'Product not found');
    if (product.isActive === false) {
      throw fieldError(['items', index, 'product'], `${product.name} is no longer sold`);
    }
    if (!allowsFractions(product.unit) && !Number.isInteger(item.quantity)) {
      throw fieldError(
        ['items', index, 'quantity'],
        `${product.name} is sold in whole ${product.unit}`,
      );
    }
    if (item.quantity > product.stock + 1e-9) {
      throw fieldError(
        ['items', index, 'quantity'],
        `Only ${Number(product.stock.toFixed(3))} ${product.unit} of ${product.name} in stock`,
        409,
      );
    }
    const gross = Math.round(product.sellingPrice * item.quantity);
    if (item.discount > gross) {
      throw fieldError(
        ['items', index, 'discount'],
        `Discount cannot be more than ${formatINR(gross)}`,
      );
    }
    const amounts = calculateLine(
      {
        unitPrice: product.sellingPrice,
        quantity: item.quantity,
        discount: item.discount,
        gstRate: product.gstRate as GstRate,
        taxInclusive: product.taxInclusive,
      },
      interState,
    );
    return {
      amounts,
      line: {
        product: product._id,
        name: product.name,
        sku: product.sku,
        hsnCode: product.hsnCode,
        unit: product.unit,
        quantity: item.quantity,
        unitPrice: product.sellingPrice,
        taxInclusive: product.taxInclusive,
        gstRate: product.gstRate,
        discount: amounts.discount,
        taxable: amounts.taxable,
        cgst: amounts.cgst,
        sgst: amounts.sgst,
        igst: amounts.igst,
        total: amounts.total,
        unitCost: product.costPrice,
      },
    };
  });
}

const isDuplicateClientRef = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: number }).code === 11000 &&
  'clientRef' in ((err as { keyPattern?: object }).keyPattern ?? {});

/**
 * Bills a customer: prices the lines, checks the payments cover the total exactly, numbers the
 * invoice for the financial year and takes the goods out of stock through the ledger, all in one
 * transaction. If any line cannot be sold, nothing is saved and no invoice number is used up.
 */
export async function createSale(
  input: SaleInput,
  userId: string,
): Promise<{ sale: SaleDto; created: boolean }> {
  const replay = async () => {
    if (!input.clientRef) return undefined;
    const existing = await SaleModel.findOne({ clientRef: input.clientRef }, { _id: 1 }).lean();
    return existing ? { sale: await getSale(String(existing._id)), created: false } : undefined;
  };
  const earlier = await replay();
  if (earlier) return earlier;

  let id: Types.ObjectId;
  try {
    id = await mongoose.connection.transaction(async (session) => {
      // One operation at a time: a transaction's session cannot run queries in parallel.
      const settings = await getShopSettings(session);
      const customer = input.customer ? await activeCustomer(input.customer, session) : null;
      const placeOfSupply = (customer?.stateCode ?? settings.stateCode) as StateCode;
      const interState = placeOfSupply !== settings.stateCode;
      const priced = await priceItems(input.items, interState, session);
      const totals = calculateInvoiceTotals(priced.map((p) => p.amounts));

      const paid = input.payments.reduce((sum, p) => sum + p.amount, 0);
      if (paid !== totals.grandTotal) {
        throw fieldError(
          ['payments'],
          `Payments add up to ${formatINR(paid)} but the bill is ${formatINR(totals.grandTotal)}`,
        );
      }

      const now = new Date();
      const seq = await nextSequence(`invoice:${financialYear(now)}`, session);
      const [sale] = await SaleModel.create(
        [
          {
            invoiceNumber: formatDocumentNumber(settings.invoicePrefix, now, seq),
            ...(customer && {
              customer: customer._id,
              customerSnapshot: {
                name: customer.name,
                ...(customer.phone && { phone: customer.phone }),
                ...(customer.gstin && { gstin: customer.gstin }),
                ...(customer.stateCode && { stateCode: customer.stateCode }),
              },
            }),
            placeOfSupply,
            interState,
            items: priced.map((p) => p.line),
            ...totals,
            payments: input.payments,
            cashier: userId,
            soldAt: now,
            notes: input.notes,
            clientRef: input.clientRef,
          },
        ],
        { session },
      );

      for (const [index, { line }] of priced.entries()) {
        try {
          await recordMovement(
            {
              product: line.product,
              type: 'sale',
              quantity: -line.quantity,
              unitCost: line.unitCost,
              ref: { model: 'Sale', id: sale!._id },
              userId,
              occurredAt: now,
            },
            session,
          );
        } catch (err) {
          // Another till sold the last units after this bill was priced.
          if (err instanceof AppError && err.code === 'INSUFFICIENT_STOCK') {
            throw fieldError(['items', index, 'quantity'], err.message, 409);
          }
          throw err;
        }
      }
      return sale!._id;
    });
  } catch (err) {
    // The same bill arrived twice at once; the first one won, so answer with it.
    if (isDuplicateClientRef(err)) {
      const first = await replay();
      if (first) return first;
    }
    throw err;
  }
  return { sale: await getSale(String(id)), created: true };
}

function customerOf(s: SaleDoc) {
  const snap = s.customerSnapshot;
  if (!snap?.name) return undefined;
  return {
    ...(s.customer && { id: String(s.customer) }),
    name: snap.name,
    ...(snap.phone && { phone: snap.phone }),
    ...(snap.gstin && { gstin: snap.gstin }),
    ...(snap.stateCode && { stateCode: snap.stateCode as StateCode }),
  };
}

function toSummary(s: SaleDoc, cashierName: string): SaleSummaryDto {
  const customer = customerOf(s);
  return {
    id: String(s._id),
    invoiceNumber: s.invoiceNumber,
    soldAt: iso(s.soldAt),
    ...(customer && { customer }),
    itemCount: s.items.length,
    totalTax: s.totalTax,
    grandTotal: s.grandTotal,
    paymentMethods: s.payments.map((p) => p.method as PaymentMethod),
    status: s.status,
    cashier: { id: String(s.cashier), name: cashierName },
  };
}

async function cashierNames(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const users = await UserModel.find({ _id: { $in: ids } }, { name: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

function listFilter(query: SaleListQuery) {
  const filter: mongoose.QueryFilter<Record<string, unknown>> = {};
  if (query.from || query.to) {
    filter.soldAt = {
      ...(query.from && { $gte: istDayRange(query.from).start }),
      ...(query.to && { $lt: istDayRange(query.to).end }),
    };
  }
  if (query.search) {
    const pattern = containsPattern(query.search);
    filter.$or = [
      { invoiceNumber: pattern },
      { 'customerSnapshot.name': pattern },
      { 'customerSnapshot.phone': pattern },
    ];
  }
  if (query.method) filter['payments.method'] = query.method;
  if (query.cashier) filter.cashier = toObjectId(query.cashier);
  return filter;
}

export async function listSales(query: SaleListQuery): Promise<SaleList> {
  const filter = listFilter(query);
  const [sales, totals] = await Promise.all([
    SaleModel.find(filter)
      .sort({ soldAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<SaleDoc[]>(),
    SaleModel.aggregate<{ count: number; total: number }>([
      { $match: filter },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' } } },
    ]),
  ]);
  const names = await cashierNames(sales.map((s) => s.cashier));
  const summary = { count: totals[0]?.count ?? 0, total: totals[0]?.total ?? 0 };
  return {
    data: sales.map((s) => toSummary(s, names.get(String(s.cashier)) ?? 'Unknown')),
    page: query.page,
    pageSize: query.pageSize,
    total: summary.count,
    summary,
  };
}

export async function getSale(id: string): Promise<SaleDto> {
  const s = await SaleModel.findById(toObjectId(id, 'Sale not found')).lean<SaleDoc>();
  if (!s) throw AppError.notFound('Sale not found');
  const names = await cashierNames([s.cashier]);
  const { paymentMethods: _methods, ...summary } = toSummary(
    s,
    names.get(String(s.cashier)) ?? 'Unknown',
  );
  return {
    ...summary,
    placeOfSupply: s.placeOfSupply as StateCode,
    interState: s.interState,
    items: s.items.map((i) => ({
      product: { id: String(i.product), name: i.name, sku: i.sku, unit: i.unit as Unit },
      hsnCode: i.hsnCode,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      taxInclusive: i.taxInclusive,
      gstRate: i.gstRate as GstRate,
      gross: Math.round(i.unitPrice * i.quantity),
      discount: i.discount,
      taxable: i.taxable,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      total: i.total,
      returnedQuantity: i.returnedQuantity,
    })),
    gross: s.gross,
    discount: s.discount,
    taxable: s.taxable,
    cgst: s.cgst,
    sgst: s.sgst,
    igst: s.igst,
    roundOff: s.roundOff,
    payments: s.payments.map((p) => ({
      method: p.method as PaymentMethod,
      amount: p.amount,
      ...(p.reference && { reference: p.reference }),
    })),
    ...(s.notes && { notes: s.notes }),
  };
}
