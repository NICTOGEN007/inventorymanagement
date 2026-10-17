import type {
  AdjustmentReason,
  PaymentMethod,
  PurchaseOrderStatus,
  Role,
  SaleStatus,
  StockMovementType,
  Unit,
} from './constants.js';
import type { Backtest, ForecastDay, ForecastMethod, RestockStatus } from './forecast.js';
import type { GstRate } from './gst.js';
import type { RestockPlanSource, RestockPlanStatus } from './schemas/restock.js';
import type { TaxSplit } from './returns.js';
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
  /** Ordered from the supplier in packs of this many. */
  packSize: number;
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

export interface SettingsDto {
  shopName: string;
  legalName?: string;
  gstin: string;
  stateCode: StateCode;
  address?: { line1?: string; line2?: string; city?: string; pincode?: string };
  phone?: string;
  email?: string;
  invoicePrefix: string;
  purchaseOrderPrefix: string;
  returnPrefix: string;
  invoiceFooter?: string;
}

export interface TaxAmounts {
  /** Paise. */
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface PurchaseOrderItemDto extends TaxAmounts {
  product: { id: string; name: string; sku: string; unit: Unit };
  quantity: number;
  receivedQuantity: number;
  /** Still to arrive. */
  remainingQuantity: number;
  unitCost: number;
  gstRate: number;
}

export interface PurchaseOrderReceiptDto {
  receivedAt: string;
  receivedBy?: Ref;
  supplierInvoiceNumber?: string;
  note?: string;
  items: { product: Ref; quantity: number }[];
}

export interface PurchaseOrderSummaryDto extends TaxAmounts {
  id: string;
  poNumber: string;
  supplier: Ref;
  status: PurchaseOrderStatus;
  interState: boolean;
  itemCount: number;
  orderedAt?: string;
  expectedAt?: string;
  /** Still expecting goods and past the expected date. */
  overdue: boolean;
  createdAt: string;
}

export interface PurchaseOrderDto extends PurchaseOrderSummaryDto {
  supplierDetails: {
    name: string;
    gstin?: string;
    stateCode: StateCode;
    phone?: string;
    email?: string;
    leadTimeDays: number;
  };
  items: PurchaseOrderItemDto[];
  receipts: PurchaseOrderReceiptDto[];
  notes?: string;
  receivedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  createdBy?: Ref;
}

export interface CustomerSummaryDto {
  id: string;
  name: string;
  phone?: string;
  gstin?: string;
  /** Place of supply when set; otherwise the shop's own state. */
  stateCode?: StateCode;
}

export interface PaymentDto {
  method: PaymentMethod;
  /** Paise. */
  amount: number;
  reference?: string;
}

export interface SaleItemDto {
  product: { id: string; name: string; sku: string; unit: Unit };
  hsnCode: string;
  quantity: number;
  /** Price per unit as charged (incl. GST when taxInclusive). */
  unitPrice: number;
  taxInclusive: boolean;
  gstRate: GstRate;
  /** unitPrice × quantity, before discount. */
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  returnedQuantity: number;
  /** Refunded on returns so far (taxable value and tax). */
  refunded: TaxSplit;
}

/** Buyer as printed on the invoice; absent for a walk-in customer. */
export interface SaleCustomerDto {
  id?: string;
  name: string;
  phone?: string;
  gstin?: string;
  stateCode?: StateCode;
}

export interface SaleSummaryDto {
  id: string;
  invoiceNumber: string;
  soldAt: string;
  customer?: SaleCustomerDto;
  itemCount: number;
  totalTax: number;
  grandTotal: number;
  paymentMethods: PaymentMethod[];
  status: SaleStatus;
  cashier: Ref;
}

export interface SaleDto extends Omit<SaleSummaryDto, 'paymentMethods'> {
  placeOfSupply: StateCode;
  interState: boolean;
  items: SaleItemDto[];
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Adjustment to the nearest rupee, in paise (−50 to +49). */
  roundOff: number;
  payments: PaymentDto[];
  notes?: string;
  /** Total refunded on returns against this invoice, in paise. */
  refundedTotal: number;
  /** Credit notes issued against this invoice, oldest first. */
  returns: { id: string; returnNumber: string; returnedAt: string; totalRefund: number }[];
}

export interface SaleList extends Paginated<SaleSummaryDto> {
  /** Count and value of every sale matching the filters, not just this page. */
  summary: { count: number; total: number };
}

// ---------------------------------------------------------------------------
// Customers

export interface CustomerStatsDto {
  /** Bills issued to the customer. */
  visits: number;
  /** What they spent, less refunds, in paise. */
  totalSpent: number;
  lastPurchaseAt?: string;
}

export interface CustomerListItemDto extends CustomerSummaryDto {
  email?: string;
  isActive: boolean;
  createdAt: string;
  stats: CustomerStatsDto;
}

export interface CustomerDto extends CustomerListItemDto {
  address?: { line1?: string; line2?: string; city?: string; pincode?: string };
  updatedAt: string;
  stats: CustomerStatsDto & {
    averageBill: number;
    firstPurchaseAt?: string;
    returns: number;
    refunded: number;
  };
  /** What they buy most, by amount spent. */
  topProducts: { product: Ref & { unit: Unit }; quantity: number; total: number }[];
}

// ---------------------------------------------------------------------------
// Returns (credit notes)

export interface SaleReturnItemDto extends TaxSplit {
  product: { id: string; name: string; sku: string; unit: Unit };
  hsnCode: string;
  gstRate: GstRate;
  quantity: number;
  total: number;
  /** Went back on the shelf (false for damaged goods). */
  restock: boolean;
}

export interface SaleReturnSummaryDto {
  id: string;
  returnNumber: string;
  returnedAt: string;
  sale: { id: string; invoiceNumber: string };
  customer?: SaleCustomerDto;
  itemCount: number;
  totalRefund: number;
  refundMethod: PaymentMethod;
  reason: string;
  processedBy: Ref;
}

export interface SaleReturnDto extends SaleReturnSummaryDto {
  /** When the original invoice was issued. */
  soldAt: string;
  placeOfSupply: StateCode;
  interState: boolean;
  items: SaleReturnItemDto[];
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  roundOff: number;
  refundReference?: string;
}

export interface SaleReturnList extends Paginated<SaleReturnSummaryDto> {
  summary: { count: number; total: number };
}

// --- Forecasting and Smart Restock -----------------------------------------------------------

/** One product's demand forecast and what to do about it. Quantities are in the product's unit. */
export interface ForecastItemDto {
  product: { id: string; name: string; sku: string; unit: Unit };
  supplier?: { id: string; name: string; leadTimeDays: number };
  stock: number;
  onOrder: number;
  packSize: number;
  reorderLevel: number;
  status: RestockStatus;
  method: ForecastMethod;
  /** Expected sales per day over the next week. */
  dailyDemand: number;
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  suggestedQuantity: number;
  /** Days the stock lasts, or null if more than 120. */
  daysUntilStockout: number | null;
  festival?: { name: string; inDays: number; uplift: number };
  reasons: string[];
  /** Cost per unit excluding GST, in paise (the product's current average cost). */
  unitCost: number;
  gstRate: GstRate;
}

export interface ForecastAccuracyDto {
  /** Weekly totals over the last 4 weeks, forecast from the data before them. */
  mape: number;
  /** Total absolute error ÷ total actual sales. */
  wape: number;
  /** Forecast total ÷ actual total − 1, as a percentage: negative means too low. */
  bias: number;
  /** The same for a 28-day moving average, for comparison. */
  baseline: { mape: number; wape: number; bias: number };
  products: number;
  weeks: number;
}

export interface ForecastOverviewDto {
  /** Last full day of sales the forecasts are based on (IST). */
  asOf: string;
  items: ForecastItemDto[];
  counts: Record<RestockStatus, number>;
}

export interface ProductForecastDto {
  item: ForecastItemDto;
  /** Last 8 weeks of daily sales. */
  history: { date: string; quantity: number; stockedOut: boolean }[];
  /** Next 4 weeks. */
  forecast: ForecastDay[];
  model: {
    method: ForecastMethod;
    alpha: number;
    beta: number;
    gamma: number;
    historyDays: number;
    /** Weekly pattern, Sunday first, in units above or below a normal day. */
    season: number[];
    festivalUplift: Record<string, number>;
    generalUplift: number;
  };
  backtest?: Backtest;
}

export interface RestockAlertDto {
  /** Products to reorder now. */
  reorder: number;
  /** Of those, how many will run out before a delivery ordered today could arrive. */
  runningOut: number;
  outOfStock: number;
  /** The most urgent few, for the banner. */
  items: { id: string; name: string; daysUntilStockout: number | null }[];
  /** A draft plan waiting for review, if there is one. */
  openPlan?: { id: string; planNumber: string; itemCount: number };
}

export interface RestockPlanItemDto extends TaxAmounts {
  product: { id: string; name: string; sku: string; unit: Unit };
  stock: number;
  onOrder: number;
  dailyDemand: number;
  daysUntilStockout: number | null;
  packSize: number;
  suggestedQuantity: number;
  quantity: number;
  unitCost: number;
  gstRate: GstRate;
  reasons: string[];
}

export interface RestockPlanGroupDto extends TaxAmounts {
  supplier: { id: string; name: string; leadTimeDays: number };
  interState: boolean;
  items: RestockPlanItemDto[];
  /** The purchase order placed for this supplier, once confirmed. */
  purchaseOrder?: { id: string; poNumber: string };
}

export interface RestockPlanSummaryDto extends TaxAmounts {
  id: string;
  planNumber: string;
  status: RestockPlanStatus;
  source: RestockPlanSource;
  itemCount: number;
  supplierCount: number;
  budget?: number;
  createdAt: string;
  expiresAt: string;
  createdBy?: Ref;
}

export interface RestockPlanDto extends RestockPlanSummaryDto {
  groups: RestockPlanGroupDto[];
  /** Products the plan could not include, and why. */
  skipped: { product: { id: string; name: string }; reason: string }[];
  confirmedAt?: string;
  confirmedBy?: Ref;
  cancelledAt?: string;
  /** Why a draft expired. */
  expiredReason?: string;
}

// --- AI assistant ------------------------------------------------------------------------------

export type AssistantStatusDto = { enabled: true; model: string } | { enabled: false };

export interface AssistantReplyDto {
  reply: string;
  /** Tools the model called to answer, e.g. ["get_sales_summary"]. */
  toolsUsed: string[];
  /** The restock plan the assistant prepared or changed, if it did. */
  plan?: RestockPlanDto;
}
