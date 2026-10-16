import type { AdjustmentReason, Role, StockMovementType, Unit } from './constants.js';
import type { GstRate } from './gst.js';
import type { StockStatus } from './pricing.js';
import type { StateCode } from './states.js';

/** Shapes of API responses shared by the server and the web client. */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  /** Short-lived JWT for the Authorization header; keep it in memory only. */
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: UserDto;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Ref {
  id: string;
  name: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  /** Number of products in this category (active and inactive). */
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierDto {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  stateCode: StateCode;
  address?: { line1?: string; line2?: string; city?: string; pincode?: string };
  leadTimeDays: number;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDto {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  category: Ref;
  brand?: string;
  unit: Unit;
  hsnCode: string;
  gstRate: GstRate;
  /** All money in paise. Cost is only included for roles that can see reports. */
  costPrice?: number;
  sellingPrice: number;
  mrp?: number;
  taxInclusive: boolean;
  stock: number;
  reorderLevel: number;
  reorderQuantity: number;
  stockStatus: StockStatus;
  /** Quantity on open purchase orders, not yet received. */
  onOrder: number;
  preferredSupplier?: Ref;
  imageUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovementDto {
  id: string;
  product: { id: string; name: string; sku: string; unit: Unit };
  type: StockMovementType;
  /** Signed: positive added stock, negative removed it. */
  quantity: number;
  balanceAfter: number;
  /** Cost per unit and value of the change, in paise (roles that can see reports only). */
  unitCost?: number;
  value?: number;
  reason?: AdjustmentReason;
  note?: string;
  /** The document that caused the movement, e.g. { kind: 'Sale', number: 'INV/26-27/00042' }. */
  reference?: { kind: 'Sale' | 'PurchaseOrder' | 'SaleReturn'; id: string; number: string };
  createdBy?: Ref;
  occurredAt: string;
}

export interface AdjustmentResult {
  adjusted: { product: Ref; before: number; after: number; change: number }[];
  /** Products whose counted quantity already matched the system; nothing was recorded. */
  unchanged: Ref[];
}

export interface InventoryValueRow {
  /** Paise. Cost value uses cost price (excl. GST); retail value uses the selling price. */
  costValue: number;
  retailValue: number;
  products: number;
  lowStock: number;
  outOfStock: number;
}

export interface InventorySummary extends InventoryValueRow {
  byCategory: (InventoryValueRow & { category: Ref })[];
  /** Stock written off (damaged, expired, lost) in the last 30 days, at cost. */
  writeOffs30d: { value: number; byReason: { reason: AdjustmentReason; value: number }[] };
}
