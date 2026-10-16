import type { SupplierDto, SupplierInput } from '@ims/shared';
import type { Types } from 'mongoose';
import {
  ProductModel,
  PurchaseOrderModel,
  SupplierModel,
  type Supplier,
} from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { containsPattern, iso, toObjectId } from '../../utils/query.js';

type SupplierDoc = Supplier & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

function toDto(s: SupplierDoc, productCount: number): SupplierDto {
  const address = s.address && Object.values(s.address).some(Boolean) ? s.address : undefined;
  return {
    id: String(s._id),
    name: s.name,
    ...(s.contactPerson && { contactPerson: s.contactPerson }),
    ...(s.phone && { phone: s.phone }),
    ...(s.email && { email: s.email }),
    ...(s.gstin && { gstin: s.gstin }),
    stateCode: s.stateCode,
    ...(address && {
      address: {
        ...(address.line1 && { line1: address.line1 }),
        ...(address.line2 && { line2: address.line2 }),
        ...(address.city && { city: address.city }),
        ...(address.pincode && { pincode: address.pincode }),
      },
    }),
    leadTimeDays: s.leadTimeDays,
    isActive: s.isActive ?? true,
    productCount,
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
  };
}

async function countProducts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await ProductModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { preferredSupplier: { $in: ids } } },
    { $group: { _id: '$preferredSupplier', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

export async function listSuppliers(search?: string): Promise<SupplierDto[]> {
  const filter = search
    ? {
        $or: [
          { name: containsPattern(search) },
          { contactPerson: containsPattern(search) },
          { gstin: containsPattern(search) },
        ],
      }
    : {};
  const suppliers = await SupplierModel.find(filter)
    .collation({ locale: 'en' })
    .sort({ name: 1 })
    .lean<SupplierDoc[]>();
  const counts = await countProducts(suppliers.map((s) => s._id));
  return suppliers.map((s) => toDto(s, counts.get(String(s._id)) ?? 0));
}

async function findOr404(id: string) {
  const supplier = await SupplierModel.findById(toObjectId(id, 'Supplier not found'));
  if (!supplier) throw AppError.notFound('Supplier not found');
  return supplier;
}

async function dtoFor(s: SupplierDoc) {
  return toDto(s, (await countProducts([s._id])).get(String(s._id)) ?? 0);
}

export async function getSupplier(id: string): Promise<SupplierDto> {
  return dtoFor((await findOr404(id)).toObject());
}

export async function createSupplier(input: SupplierInput): Promise<SupplierDto> {
  return dtoFor((await SupplierModel.create(input)).toObject());
}

/** Full replacement of the editable fields (the form always sends the whole supplier). */
export async function updateSupplier(id: string, input: SupplierInput): Promise<SupplierDto> {
  const supplier = await findOr404(id);
  supplier.set({
    contactPerson: undefined,
    phone: undefined,
    email: undefined,
    gstin: undefined,
    address: undefined,
    ...input,
  });
  await supplier.save();
  return dtoFor(supplier.toObject());
}

/** Only a supplier with no products and no purchase orders can be deleted. */
export async function deleteSupplier(id: string): Promise<void> {
  const supplier = await findOr404(id);
  const [hasProducts, hasOrders] = await Promise.all([
    ProductModel.exists({ preferredSupplier: supplier._id }),
    PurchaseOrderModel.exists({ supplier: supplier._id }),
  ]);
  if (hasProducts || hasOrders) {
    throw AppError.conflict(
      'This supplier has products or purchase orders. Deactivate it instead.',
    );
  }
  await supplier.deleteOne();
}
