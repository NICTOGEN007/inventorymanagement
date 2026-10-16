import type { CustomerListQuery, CustomerSummaryDto, Paginated, StateCode } from '@ims/shared';
import type { Types } from 'mongoose';
import { CustomerModel, type Customer } from '../../models/index.js';
import { containsPattern } from '../../utils/query.js';

type CustomerDoc = Customer & { _id: Types.ObjectId };

export function toCustomerSummary(c: CustomerDoc): CustomerSummaryDto {
  return {
    id: String(c._id),
    name: c.name,
    ...(c.phone && { phone: c.phone }),
    ...(c.gstin && { gstin: c.gstin }),
    ...(c.stateCode && { stateCode: c.stateCode as StateCode }),
  };
}

/** Active customers by name, phone or GSTIN; the POS uses it to put a customer on a bill. */
export async function listCustomers(
  query: CustomerListQuery,
): Promise<Paginated<CustomerSummaryDto>> {
  const filter: Record<string, unknown> = { isActive: { $ne: false } };
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
  return {
    data: customers.map(toCustomerSummary),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
