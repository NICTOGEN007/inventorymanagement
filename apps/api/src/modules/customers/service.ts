import type {
  CustomerDto,
  CustomerInput,
  CustomerListItemDto,
  CustomerListQuery,
  CustomerStatsDto,
  CustomerSummaryDto,
  Paginated,
  StateCode,
  Unit,
} from '@ims/shared';
import type { Types } from 'mongoose';
import { CustomerModel, SaleModel, SaleReturnModel, type Customer } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { containsPattern, iso, toObjectId } from '../../utils/query.js';

type CustomerDoc = Customer & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

export function toCustomerSummary(c: CustomerDoc): CustomerSummaryDto {
  return {
    id: String(c._id),
    name: c.name,
    ...(c.phone && { phone: c.phone }),
    ...(c.gstin && { gstin: c.gstin }),
    ...(c.stateCode && { stateCode: c.stateCode as StateCode }),
  };
}

interface SalesStats extends CustomerStatsDto {
  firstPurchaseAt?: string;
}

/** Bills, net spend (after refunds) and first/last visit for each customer, in one query. */
async function salesStats(ids: Types.ObjectId[]): Promise<Map<string, SalesStats>> {
  const rows = await SaleModel.aggregate<{
    _id: Types.ObjectId;
    visits: number;
    spent: number;
    first: Date;
    last: Date;
  }>([
    { $match: { customer: { $in: ids }, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: '$customer',
        visits: { $sum: 1 },
        spent: { $sum: { $subtract: ['$grandTotal', { $ifNull: ['$refundedTotal', 0] }] } },
        first: { $min: '$soldAt' },
        last: { $max: '$soldAt' },
      },
    },
  ]);
  return new Map(
    rows.map((r) => [
      String(r._id),
      {
        visits: r.visits,
        totalSpent: r.spent,
        firstPurchaseAt: iso(r.first),
        lastPurchaseAt: iso(r.last),
      },
    ]),
  );
}

const NO_SALES: SalesStats = { visits: 0, totalSpent: 0 };

function toListItem(c: CustomerDoc, stats: SalesStats): CustomerListItemDto {
  return {
    ...toCustomerSummary(c),
    ...(c.email && { email: c.email }),
    isActive: c.isActive ?? true,
    createdAt: iso(c.createdAt),
    stats: {
      visits: stats.visits,
      totalSpent: stats.totalSpent,
      ...(stats.lastPurchaseAt && { lastPurchaseAt: stats.lastPurchaseAt }),
    },
  };
}

/** Customers by name, phone or GSTIN; the POS uses the same list to put a customer on a bill. */
export async function listCustomers(
  query: CustomerListQuery,
): Promise<Paginated<CustomerListItemDto>> {
  const filter: Record<string, unknown> = {};
  if (query.status === 'active') filter.isActive = { $ne: false };
  if (query.status === 'inactive') filter.isActive = false;
  if (query.search) {
    const pattern = containsPattern(query.search);
    filter.$or = [{ name: pattern }, { phone: pattern }, { gstin: pattern }];
  }
  const [customers, total] = await Promise.all([
    CustomerModel.find(filter)
      .sort({ name: 1, _id: 1 })
      .collation({ locale: 'en' })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<CustomerDoc[]>(),
    CustomerModel.countDocuments(filter),
  ]);
  const stats = await salesStats(customers.map((c) => c._id));
  return {
    data: customers.map((c) => toListItem(c, stats.get(String(c._id)) ?? NO_SALES)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

async function findOr404(id: string) {
  const customer = await CustomerModel.findById(toObjectId(id, 'Customer not found'));
  if (!customer) throw AppError.notFound('Customer not found');
  return customer;
}

export async function getCustomer(id: string): Promise<CustomerDto> {
  const c = (await findOr404(id)).toObject() as CustomerDoc;
  const [stats, returns, top] = await Promise.all([
    salesStats([c._id]).then((m) => m.get(String(c._id)) ?? NO_SALES),
    SaleReturnModel.aggregate<{ count: number; refunded: number }>([
      { $match: { customer: c._id } },
      { $group: { _id: null, count: { $sum: 1 }, refunded: { $sum: '$totalRefund' } } },
    ]),
    // What they buy most, after anything they brought back.
    SaleModel.aggregate<{
      _id: Types.ObjectId;
      name: string;
      unit: Unit;
      quantity: number;
      total: number;
    }>([
      { $match: { customer: c._id, status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $last: '$items.name' },
          unit: { $last: '$items.unit' },
          quantity: {
            $sum: {
              $subtract: ['$items.quantity', { $ifNull: ['$items.returnedQuantity', 0] }],
            },
          },
          total: {
            $sum: {
              $subtract: [
                '$items.total',
                {
                  $add: [
                    { $ifNull: ['$items.refunded.taxable', 0] },
                    { $ifNull: ['$items.refunded.cgst', 0] },
                    { $ifNull: ['$items.refunded.sgst', 0] },
                    { $ifNull: ['$items.refunded.igst', 0] },
                  ],
                },
              ],
            },
          },
        },
      },
      { $match: { quantity: { $gt: 0 } } },
      { $sort: { total: -1, _id: 1 } },
      { $limit: 5 },
    ]),
  ]);
  const address = c.address && Object.values(c.address).some(Boolean) ? c.address : undefined;
  const base = toListItem(c, stats);
  return {
    ...base,
    ...(address && {
      address: {
        ...(address.line1 && { line1: address.line1 }),
        ...(address.line2 && { line2: address.line2 }),
        ...(address.city && { city: address.city }),
        ...(address.pincode && { pincode: address.pincode }),
      },
    }),
    updatedAt: iso(c.updatedAt),
    stats: {
      ...base.stats,
      averageBill: stats.visits ? Math.round(stats.totalSpent / stats.visits) : 0,
      ...(stats.firstPurchaseAt && { firstPurchaseAt: stats.firstPurchaseAt }),
      returns: returns[0]?.count ?? 0,
      refunded: returns[0]?.refunded ?? 0,
    },
    topProducts: top.map((t) => ({
      product: { id: String(t._id), name: t.name, unit: t.unit },
      quantity: Math.round(t.quantity * 1000) / 1000,
      total: t.total,
    })),
  };
}

export async function createCustomer(input: CustomerInput): Promise<CustomerDto> {
  const customer = await CustomerModel.create(input);
  return getCustomer(String(customer._id));
}

/** Full replacement of the editable fields (the form always sends the whole customer). */
export async function updateCustomer(id: string, input: CustomerInput): Promise<CustomerDto> {
  const customer = await findOr404(id);
  customer.set({
    phone: undefined,
    email: undefined,
    gstin: undefined,
    stateCode: undefined,
    address: undefined,
    ...input,
  });
  await customer.save();
  return getCustomer(id);
}

/** Only a customer who was never billed can be deleted; past invoices keep their name. */
export async function deleteCustomer(id: string): Promise<void> {
  const customer = await findOr404(id);
  if (await SaleModel.exists({ customer: customer._id })) {
    throw AppError.conflict('This customer has bills on record. Deactivate them instead.');
  }
  await customer.deleteOne();
}
