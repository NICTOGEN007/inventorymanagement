import {
  stockStatus,
  type ProductCreateInput,
  type ProductDto,
  type ProductUpdateInput,
  type Paginated,
  type ProductListQuery,
} from '@ims/shared';
import mongoose, { type Types } from 'mongoose';
import {
  CategoryModel,
  ProductModel,
  PurchaseOrderModel,
  StockMovementModel,
  SupplierModel,
  type Product,
} from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { containsPattern, iso, toObjectId } from '../../utils/query.js';

type ProductDoc = Product & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const OPEN_PO_STATUSES = ['ordered', 'partially_received'];

/** Quantity still to arrive on open purchase orders, per product. */
export async function onOrderFor(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await PurchaseOrderModel.aggregate<{ _id: Types.ObjectId; quantity: number }>([
    { $match: { status: { $in: OPEN_PO_STATUSES }, 'items.product': { $in: ids } } },
    { $unwind: '$items' },
    { $match: { 'items.product': { $in: ids } } },
    {
      $group: {
        _id: '$items.product',
        quantity: { $sum: { $subtract: ['$items.quantity', '$items.receivedQuantity'] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.quantity]));
}

/** Converts products to DTOs, loading category/supplier names and on-order quantities in bulk. */
async function toDtos(products: ProductDoc[]): Promise<ProductDto[]> {
  const categoryIds = [...new Set(products.map((p) => String(p.category)))];
  const supplierIds = [
    ...new Set(products.flatMap((p) => (p.preferredSupplier ? [String(p.preferredSupplier)] : []))),
  ];
  const [categories, suppliers, onOrder] = await Promise.all([
    CategoryModel.find({ _id: { $in: categoryIds } }, { name: 1 }).lean(),
    SupplierModel.find({ _id: { $in: supplierIds } }, { name: 1 }).lean(),
    onOrderFor(products.map((p) => p._id)),
  ]);
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));
  const supplierName = new Map(suppliers.map((s) => [String(s._id), s.name]));

  return products.map((p) => ({
    id: String(p._id),
    sku: p.sku,
    ...(p.barcode && { barcode: p.barcode }),
    name: p.name,
    ...(p.description && { description: p.description }),
    category: { id: String(p.category), name: categoryName.get(String(p.category)) ?? 'Unknown' },
    ...(p.brand && { brand: p.brand }),
    unit: p.unit,
    hsnCode: p.hsnCode,
    gstRate: p.gstRate as ProductDto['gstRate'],
    costPrice: p.costPrice,
    sellingPrice: p.sellingPrice,
    ...(p.mrp != null && { mrp: p.mrp }),
    taxInclusive: p.taxInclusive ?? true,
    stock: p.stock,
    reorderLevel: p.reorderLevel,
    reorderQuantity: p.reorderQuantity,
    stockStatus: stockStatus(p.stock, p.reorderLevel),
    onOrder: onOrder.get(String(p._id)) ?? 0,
    ...(p.preferredSupplier && {
      preferredSupplier: {
        id: String(p.preferredSupplier),
        name: supplierName.get(String(p.preferredSupplier)) ?? 'Unknown',
      },
    }),
    ...(p.imageUrl && { imageUrl: p.imageUrl }),
    isActive: p.isActive ?? true,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  }));
}

const SORTS: Record<ProductListQuery['sort'], Record<string, 1 | -1>> = {
  name: { name: 1 },
  '-name': { name: -1 },
  sku: { sku: 1 },
  stock: { stock: 1 },
  '-stock': { stock: -1 },
  sellingPrice: { sellingPrice: 1 },
  '-sellingPrice': { sellingPrice: -1 },
  '-updatedAt': { updatedAt: -1 },
};

export async function listProducts(query: ProductListQuery): Promise<Paginated<ProductDto>> {
  const filter: mongoose.QueryFilter<Record<string, unknown>> = {};
  if (query.status !== 'all') filter.isActive = query.status === 'active';
  if (query.category) filter.category = toObjectId(query.category);
  if (query.supplier) filter.preferredSupplier = toObjectId(query.supplier);
  if (query.search) {
    const pattern = containsPattern(query.search);
    filter.$or = [{ name: pattern }, { sku: pattern }, { barcode: pattern }, { brand: pattern }];
  }
  if (query.stock === 'out') filter.stock = { $lte: 0 };
  if (query.stock === 'low')
    filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$reorderLevel'] }] };
  if (query.stock === 'ok') filter.$expr = { $gt: ['$stock', '$reorderLevel'] };

  const [products, total] = await Promise.all([
    ProductModel.find(filter)
      .collation({ locale: 'en' })
      .sort({ ...SORTS[query.sort], _id: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<ProductDoc[]>(),
    ProductModel.countDocuments(filter),
  ]);
  return { data: await toDtos(products), page: query.page, pageSize: query.pageSize, total };
}

async function findOr404(id: string) {
  const product = await ProductModel.findById(toObjectId(id, 'Product not found'));
  if (!product) throw AppError.notFound('Product not found');
  return product;
}

export async function getProduct(id: string): Promise<ProductDto> {
  const [dto] = await toDtos([(await findOr404(id)).toObject()]);
  return dto!;
}

/** Finds an active product by exact barcode or SKU (for barcode scanners at the POS). */
export async function lookupProduct(code: string): Promise<ProductDto> {
  const value = code.trim();
  const product = await ProductModel.findOne({
    isActive: true,
    $or: [{ barcode: value }, { sku: value.toUpperCase() }],
  }).lean<ProductDoc>();
  if (!product) throw AppError.notFound(`No product with barcode or SKU "${value}"`);
  const [dto] = await toDtos([product]);
  return dto!;
}

/** Category and supplier must exist; a fieldful 400 otherwise. */
async function checkReferences(input: { category?: string; preferredSupplier?: string }) {
  const [category, supplier] = await Promise.all([
    input.category ? CategoryModel.exists({ _id: input.category }) : true,
    input.preferredSupplier ? SupplierModel.exists({ _id: input.preferredSupplier }) : true,
  ]);
  const details = [
    ...(!category ? [{ path: ['category'], message: 'Category not found' }] : []),
    ...(!supplier ? [{ path: ['preferredSupplier'], message: 'Supplier not found' }] : []),
  ];
  if (details.length > 0) throw AppError.badRequest(details[0]!.message, details);
}

/**
 * Creates a product. Opening stock is recorded as an "opening" movement in the stock ledger,
 * in the same transaction, so stock and ledger always agree.
 */
export async function createProduct(
  input: ProductCreateInput & { openingStock: number },
  userId: string,
) {
  await checkReferences(input);
  const { openingStock, ...fields } = input;

  const id = await mongoose.connection.transaction(async (session) => {
    const [product] = await ProductModel.create([{ ...fields, stock: openingStock }], { session });
    if (openingStock > 0) {
      await StockMovementModel.create(
        [
          {
            product: product!._id,
            type: 'opening',
            quantity: openingStock,
            balanceAfter: openingStock,
            unitCost: product!.costPrice,
            note: 'Opening stock',
            createdBy: userId,
            occurredAt: new Date(),
          },
        ],
        { session },
      );
    }
    return product!._id;
  });
  return getProduct(String(id));
}

const PRICE_FIELDS = ['costPrice', 'sellingPrice', 'mrp', 'gstRate', 'taxInclusive'] as const;

export async function updateProduct(id: string, input: ProductUpdateInput) {
  const product = await findOr404(id);
  await checkReferences(input);

  // Re-check the MRP rule against the merged values, since only some fields may be sent.
  const merged = { ...product.toObject(), ...input };
  if (merged.mrp != null && merged.taxInclusive && merged.sellingPrice > merged.mrp) {
    throw AppError.badRequest('Selling price cannot be more than the MRP', [
      { path: ['sellingPrice'], message: 'Selling price cannot be more than the MRP' },
    ]);
  }

  const priceChanges = Object.fromEntries(
    PRICE_FIELDS.filter((f) => f in input && input[f] !== product[f]).map((f) => [
      f,
      { from: product[f], to: input[f] },
    ]),
  );
  // An empty optional field in the form means "remove it".
  const unset = (
    ['barcode', 'brand', 'description', 'preferredSupplier', 'imageUrl', 'mrp'] as const
  ).filter((f) => f in input && input[f] === undefined);
  product.set(input);
  for (const field of unset) product.set(field, undefined);
  await product.save();
  return { product: await getProduct(id), priceChanges };
}
