import {
  calculateGst,
  calculateInvoiceTotals,
  calculateLine,
  financialYear,
  formatDocumentNumber,
  gstinCheckCharacter,
  istDateParts,
  rupeesToPaise,
  taxableFromInclusive,
  type AdjustmentReason,
  type GstRate,
  type LineAmounts,
  type PaymentMethod,
  type Role,
  type StateCode,
  type StockMovementType,
  type Unit,
} from '@ims/shared';
import { Types } from 'mongoose';
import {
  ADJUSTMENTS,
  BUSINESS_CUSTOMERS,
  CATEGORIES,
  DEMO_USERS,
  FESTIVALS,
  FIRST_NAMES,
  LAST_NAMES,
  PRODUCTS,
  RETURN_REASONS,
  SHOP,
  SUPPLIERS,
  type ProductDef,
  type Season,
  type Trend,
} from './catalog.js';
import { createRng } from './random.js';

/**
 * Generates a year (by default) of realistic, internally consistent shop history by simulating
 * each day: goods arrive from suppliers, customers buy what is in stock, the shop reorders when
 * stock reaches the reorder level, and a few returns and stock adjustments happen.
 *
 * Every stock change produces a StockMovement, so for each product:
 *   final stock = sum of all its movements, and stock never goes negative.
 *
 * The output is plain objects with pre-assigned ids, ready for `insertMany`. It is a pure
 * function of its options: the same seed, length and end date always give the same data.
 */

export interface GenerateOptions {
  /** Number of calendar days of history, ending today. */
  days: number;
  seed: number;
  /** "Today": events after this moment are not generated. */
  now: Date;
}

type Id = Types.ObjectId;

interface Amounts {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface SeedUser {
  _id: Id;
  name: string;
  email: string;
  role: Role;
  password: string;
}

export interface SeedProduct {
  _id: Id;
  sku: string;
  barcode: string;
  name: string;
  category: Id;
  brand: string;
  unit: Unit;
  hsnCode: string;
  gstRate: GstRate;
  costPrice: number;
  sellingPrice: number;
  mrp: number;
  taxInclusive: boolean;
  stock: number;
  reorderLevel: number;
  reorderQuantity: number;
  preferredSupplier: Id;
  isActive: boolean;
  createdAt: Date;
}

export interface SeedCustomer {
  _id: Id;
  name: string;
  phone: string;
  email?: string;
  gstin?: string;
  stateCode: StateCode;
  address: { city: string; pincode: string };
  createdAt: Date;
}

export interface SeedSaleItem extends Amounts {
  product: Id;
  name: string;
  sku: string;
  hsnCode: string;
  unit: Unit;
  quantity: number;
  unitPrice: number;
  taxInclusive: boolean;
  gstRate: GstRate;
  discount: number;
  total: number;
  unitCost: number;
  returnedQuantity: number;
}

export interface SeedSale extends Amounts {
  _id: Id;
  invoiceNumber: string;
  customer?: Id;
  customerSnapshot?: { name: string; phone: string; gstin?: string; stateCode: string };
  placeOfSupply: StateCode;
  interState: boolean;
  items: SeedSaleItem[];
  gross: number;
  discount: number;
  totalTax: number;
  roundOff: number;
  grandTotal: number;
  payments: { method: PaymentMethod; amount: number; reference?: string }[];
  status: 'completed' | 'partially_returned' | 'returned';
  cashier: Id;
  soldAt: Date;
}

export interface SeedPurchaseOrder extends Amounts {
  _id: Id;
  poNumber: string;
  supplier: Id;
  status: 'ordered' | 'received';
  items: (Amounts & {
    product: Id;
    name: string;
    quantity: number;
    receivedQuantity: number;
    unitCost: number;
    gstRate: GstRate;
    total: number;
  })[];
  interState: boolean;
  total: number;
  orderedAt: Date;
  expectedAt: Date;
  receivedAt?: Date;
  supplierInvoiceNumber?: string;
  receipts: {
    receivedAt: Date;
    receivedBy: Id;
    supplierInvoiceNumber: string;
    items: { product: Id; quantity: number }[];
  }[];
  createdBy: Id;
}

export interface SeedSaleReturn extends Amounts {
  _id: Id;
  returnNumber: string;
  sale: Id;
  invoiceNumber: string;
  items: (Amounts & {
    product: Id;
    name: string;
    quantity: number;
    total: number;
    restock: boolean;
  })[];
  totalRefund: number;
  refundMethod: PaymentMethod;
  reason: string;
  processedBy: Id;
  returnedAt: Date;
}

export interface SeedStockMovement {
  _id: Id;
  product: Id;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  unitCost: number;
  refModel?: 'Sale' | 'PurchaseOrder' | 'SaleReturn';
  refId?: Id;
  note?: string;
  reason?: AdjustmentReason;
  createdBy: Id;
  occurredAt: Date;
}

export interface Dataset {
  settings: typeof SHOP & { gstin: string };
  users: SeedUser[];
  categories: { _id: Id; name: string; description: string; createdAt: Date }[];
  suppliers: {
    _id: Id;
    name: string;
    contactPerson: string;
    phone: string;
    email: string;
    gstin: string;
    stateCode: StateCode;
    address: { city: string; pincode: string };
    leadTimeDays: number;
    createdAt: Date;
  }[];
  products: SeedProduct[];
  customers: SeedCustomer[];
  purchaseOrders: SeedPurchaseOrder[];
  sales: SeedSale[];
  saleReturns: SeedSaleReturn[];
  stockMovements: SeedStockMovement[];
  counters: { _id: string; seq: number }[];
}

// ---------------------------------------------------------------------------
// Calendar helpers. A "day" is the UTC-midnight timestamp of an IST calendar date.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const IST_OFFSET_MINUTES = 330;

/** The instant at `minutes` past midnight IST on `day`. */
function at(day: number, minutes: number): Date {
  return new Date(day + (minutes - IST_OFFSET_MINUTES) * 60_000);
}

// Footfall by weekday (Sunday first): weekends are busiest.
const WEEKDAY_FACTOR = [1.35, 0.85, 0.85, 0.9, 0.95, 1.1, 1.3] as const;

// Seasonal demand by month (January first).
const SEASON_FACTOR: Record<Season, readonly number[]> = {
  summer: [0.8, 0.85, 1.3, 1.7, 1.8, 1.4, 1, 0.9, 0.9, 0.9, 0.8, 0.8],
  winter: [1.35, 1.3, 1.1, 0.8, 0.8, 0.8, 1, 1, 1, 1.1, 1.3, 1.35],
  monsoon: [0.7, 0.7, 0.7, 0.7, 0.8, 1.4, 2, 2, 1.6, 1.2, 0.8, 0.7],
  school: [0.8, 0.8, 1.1, 1.2, 1, 2.6, 1.6, 0.9, 0.8, 0.8, 0.8, 0.8],
  festival: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};

/** Demand multiplier over the simulated period, t in [0, 1]. */
function trendFactor(trend: Trend | undefined, t: number): number {
  if (trend === 'growing') return 0.6 + 0.9 * t;
  if (trend === 'declining') return 1.4 - 0.9 * t;
  return 1;
}

const FESTIVAL_DAYS = FESTIVALS.map((f) => ({ ...f, day: Date.parse(`${f.date}T00:00:00Z`) }));

/** Footfall and festive-goods multipliers for a day; shopping builds up before a festival. */
function festivalFactors(day: number): { footfall: number; festiveGoods: number } {
  let footfall = 1;
  let festiveGoods = 1;
  for (const f of FESTIVAL_DAYS) {
    const daysBefore = (f.day - day) / DAY_MS;
    if (daysBefore >= 0 && daysBefore <= f.leadDays) {
      const ramp = 1 - daysBefore / (f.leadDays + 1);
      footfall = Math.max(footfall, 1 + (f.footfall - 1) * ramp);
      festiveGoods = Math.max(festiveGoods, 1 + (f.festiveGoods - 1) * ramp);
    } else if (daysBefore === -1) {
      footfall = Math.min(footfall, 0.85); // quiet day after a big festival
    }
  }
  return { footfall, festiveGoods };
}

// ---------------------------------------------------------------------------

const BASE_BILLS_PER_DAY = 30;
const MEAN_LINES_PER_BILL = 2.7;
const DEFAULT_QUANTITIES = [1, 1, 1, 1, 2, 2, 3] as const;
const PAYMENT_WEIGHTS: [PaymentMethod, number][] = [
  ['cash', 0.42],
  ['upi', 0.48],
  ['card', 0.1],
];
const LOW_STOCK_DEMO_DAYS = 30;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** EAN-13 check digit. */
function ean13(first12: string): string {
  const sum = [...first12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return first12 + ((10 - (sum % 10)) % 10);
}

const gstinFrom = (body: string) => body + gstinCheckCharacter(body);

interface ProductState {
  def: ProductDef;
  doc: SeedProduct;
  meanQuantity: number;
  leadTimeDays: number;
  supplierIndex: number;
  /** True while a purchase order for this product is open. */
  onOrder: boolean;
}

interface PendingReceipt {
  po: SeedPurchaseOrder;
  day: number;
}

interface PendingReturn {
  sale: SeedSale;
  itemIndex: number;
  quantity: number;
}

export function generateDataset({ days, seed, now }: GenerateOptions): Dataset {
  if (!Number.isInteger(days) || days < 7 || days > 1100) {
    throw new RangeError('days must be an integer between 7 and 1100');
  }

  const rng = createRng(seed);
  const idRng = createRng(seed ^ 0x5eed);
  /** ObjectIds whose embedded timestamp matches the business date, so _id order follows time. */
  const newId = (date: Date): Id => {
    const seconds = Math.floor(date.getTime() / 1000)
      .toString(16)
      .padStart(8, '0');
    return new Types.ObjectId(seconds + idRng.string(16, '0123456789abcdef'));
  };

  const { year, month, day: dom } = istDateParts(now);
  const today = Date.UTC(year, month - 1, dom);
  const firstDay = today - (days - 1) * DAY_MS;
  const setupTime = at(firstDay - 7 * DAY_MS, 10 * 60);

  // --- Master data ---------------------------------------------------------

  const users: SeedUser[] = DEMO_USERS.map((u) => ({
    _id: newId(setupTime),
    name: u.name,
    email: u.email,
    role: u.role,
    password: u.password,
  }));
  const userByKey = new Map(DEMO_USERS.map((u, i) => [u.key, users[i]!._id]));
  const adminId = userByKey.get('admin')!;
  const managerId = userByKey.get('manager')!;
  const cashierIds = [userByKey.get('cashier1')!, userByKey.get('cashier2')!];

  const settings = { ...SHOP, gstin: gstinFrom(SHOP.gstinBody) };

  const categories = CATEGORIES.map((c) => ({
    _id: newId(setupTime),
    name: c.name,
    description: c.description,
    createdAt: setupTime,
  }));
  const categoryId = new Map(CATEGORIES.map((c, i) => [c.key, categories[i]!._id]));

  const suppliers = SUPPLIERS.map((s) => ({
    _id: newId(setupTime),
    name: s.name,
    contactPerson: s.contactPerson,
    phone: s.phone,
    email: s.email,
    gstin: gstinFrom(s.gstinBody),
    stateCode: s.stateCode,
    address: { city: s.city, pincode: s.pincode },
    leadTimeDays: s.leadTimeDays,
    createdAt: setupTime,
  }));
  const supplierIndex = new Map(SUPPLIERS.map((s, i) => [s.key, i]));

  const totalPopularity = PRODUCTS.reduce((sum, p) => sum + p.popularity, 0);
  const products: ProductState[] = PRODUCTS.map((def, index) => {
    const sIndex = supplierIndex.get(def.supplier);
    if (sIndex === undefined) throw new Error(`Unknown supplier ${def.supplier} for ${def.sku}`);
    const leadTimeDays = SUPPLIERS[sIndex]!.leadTimeDays;
    const mrp = rupeesToPaise(def.mrp);
    const sellingPrice = rupeesToPaise(Math.round(def.mrp * (def.priceFactor ?? 1)));
    const costPrice = Math.round(
      taxableFromInclusive(sellingPrice, def.gstRate) * (1 - def.margin),
    );
    const meanQuantity = mean(def.quantities ?? DEFAULT_QUANTITIES);

    // The shop owner's reorder settings: about two weeks of typical demand per order, and
    // a reorder level that covers the supplier's lead time with a safety margin.
    const expectedDaily =
      BASE_BILLS_PER_DAY *
      1.1 *
      MEAN_LINES_PER_BILL *
      (def.popularity / totalPopularity) *
      meanQuantity;
    const pack = def.unit === 'kg' ? 25 : def.mrp < 100 ? 12 : 6;
    const reorderLevel = Math.max(3, Math.ceil(expectedDaily * (leadTimeDays + 3) * 1.5));
    const reorderQuantity = Math.max(pack, Math.ceil((expectedDaily * 18) / pack) * pack);
    const openingStock = reorderQuantity + reorderLevel;

    const doc: SeedProduct = {
      _id: newId(setupTime),
      sku: def.sku,
      barcode: ean13(`21${String(index + 1).padStart(10, '0')}`),
      name: def.name,
      category: categoryId.get(def.category)!,
      brand: def.brand,
      unit: def.unit,
      hsnCode: def.hsnCode,
      gstRate: def.gstRate,
      costPrice,
      sellingPrice,
      mrp,
      taxInclusive: true,
      stock: openingStock,
      reorderLevel,
      reorderQuantity,
      preferredSupplier: suppliers[sIndex]!._id,
      isActive: true,
      createdAt: setupTime,
    };
    return { def, doc, meanQuantity, leadTimeDays, supplierIndex: sIndex, onOrder: false };
  });

  // Customers: walk-in regulars plus a few businesses that buy in bulk.
  const usedPhones = new Set<string>(BUSINESS_CUSTOMERS.map((b) => b.phone));
  const randomPhone = () => {
    for (;;) {
      const phone = String(rng.int(6, 9)) + rng.string(9, '0123456789');
      if (!usedPhones.has(phone)) {
        usedPhones.add(phone);
        return phone;
      }
    }
  };
  const individuals: SeedCustomer[] = Array.from({ length: 80 }, (_, i) => {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last = LAST_NAMES[(i * 7 + Math.floor(i / FIRST_NAMES.length)) % LAST_NAMES.length]!;
    const since = at(firstDay + rng.int(-200, days - 10) * DAY_MS, 12 * 60);
    return {
      _id: newId(since),
      name: `${first} ${last}`,
      phone: randomPhone(),
      ...(rng.chance(0.4) && {
        email: `${first}.${last}${i}@example.com`.toLowerCase().replace(/[^a-z0-9.@]/g, ''),
      }),
      stateCode: SHOP.stateCode,
      address: {
        city: 'Bengaluru',
        pincode: String(rng.pick([560038, 560008, 560075, 560017, 560093])),
      },
      createdAt: since,
    };
  });
  const businesses: SeedCustomer[] = BUSINESS_CUSTOMERS.map((b) => ({
    _id: newId(setupTime),
    name: b.name,
    phone: b.phone,
    gstin: gstinFrom(b.gstinBody),
    stateCode: b.stateCode,
    address: { city: b.city, pincode: b.pincode },
    createdAt: setupTime,
  }));
  // A fifth of individual customers are regulars who visit far more often.
  const customerWeights = individuals.map((_, i) => (i < 16 ? 5 : 1));

  // --- Simulation ----------------------------------------------------------

  const counters = new Map<string, number>();
  const nextNumber = (kind: 'invoice' | 'purchaseOrder' | 'return', prefix: string, date: Date) => {
    const key = `${kind}:${financialYear(date)}`;
    const seq = (counters.get(key) ?? 0) + 1;
    counters.set(key, seq);
    return formatDocumentNumber(prefix, date, seq);
  };

  const sales: SeedSale[] = [];
  const purchaseOrders: SeedPurchaseOrder[] = [];
  const saleReturns: SeedSaleReturn[] = [];
  const stockMovements: SeedStockMovement[] = [];
  const receipts: PendingReceipt[] = [];
  const returnsByDay = new Map<number, PendingReturn[]>();

  const move = (
    product: ProductState,
    type: StockMovementType,
    quantity: number,
    occurredAt: Date,
    createdBy: Id,
    ref?: { model: 'Sale' | 'PurchaseOrder' | 'SaleReturn'; id: Id },
    note?: string,
    reason?: AdjustmentReason,
  ) => {
    product.doc.stock = round3(product.doc.stock + quantity);
    if (product.doc.stock < 0) throw new Error(`Stock went negative for ${product.def.sku}`);
    stockMovements.push({
      _id: newId(occurredAt),
      product: product.doc._id,
      type,
      quantity: round3(quantity),
      balanceAfter: product.doc.stock,
      unitCost: product.doc.costPrice,
      ...(ref && { refModel: ref.model, refId: ref.id }),
      ...(note && { note }),
      ...(reason && { reason }),
      createdBy,
      occurredAt,
    });
  };

  // Opening stock on the first morning.
  const openingTime = at(firstDay, 8 * 60);
  for (const p of products) {
    const opening = p.doc.stock;
    p.doc.stock = 0;
    move(p, 'opening', opening, openingTime, adminId, undefined, 'Opening stock');
  }

  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const day = firstDay + dayIndex * DAY_MS;
    const daysLeft = days - 1 - dayIndex;
    const t = days > 1 ? dayIndex / (days - 1) : 1;
    const date = new Date(day);
    const monthIndex = date.getUTCMonth();
    const festival = festivalFactors(day);
    const happened = (when: Date) => when.getTime() <= now.getTime();

    // 1. Goods arrive from suppliers in the morning.
    const receiptTime = at(day, 8 * 60 + 30);
    if (happened(receiptTime)) {
      for (const receipt of receipts.filter((r) => r.day === dayIndex)) {
        const po = receipt.po;
        po.status = 'received';
        po.receivedAt = receiptTime;
        po.supplierInvoiceNumber = `SI-${rng.string(6, '0123456789')}`;
        po.receipts.push({
          receivedAt: receiptTime,
          receivedBy: managerId,
          supplierInvoiceNumber: po.supplierInvoiceNumber,
          items: po.items.map((i) => ({ product: i.product, quantity: i.quantity })),
        });
        for (const item of po.items) {
          item.receivedQuantity = item.quantity;
          const product = products.find((p) => p.doc._id.equals(item.product))!;
          move(product, 'purchase', item.quantity, receiptTime, managerId, {
            model: 'PurchaseOrder',
            id: po._id,
          });
          product.onOrder = false;
        }
      }
    }

    // 2. Customer returns, handled before the shop gets busy.
    for (const [i, pending] of (returnsByDay.get(dayIndex) ?? []).entries()) {
      const returnedAt = at(day, 9 * 60 + 5 + i * 3);
      if (!happened(returnedAt)) continue;
      const item = pending.sale.items[pending.itemIndex]!;
      const product = products.find((p) => p.doc._id.equals(item.product))!;
      const { reason, restock } = rng.pick(RETURN_REASONS);
      const share = pending.quantity / item.quantity;
      const part = (value: number) => Math.round(value * share);
      const line = {
        taxable: part(item.taxable),
        cgst: part(item.cgst),
        sgst: part(item.sgst),
        igst: part(item.igst),
      };
      const total = line.taxable + line.cgst + line.sgst + line.igst;
      const saleReturn: SeedSaleReturn = {
        _id: newId(returnedAt),
        returnNumber: nextNumber('return', 'RET', returnedAt),
        sale: pending.sale._id,
        invoiceNumber: pending.sale.invoiceNumber,
        items: [
          {
            product: item.product,
            name: item.name,
            quantity: pending.quantity,
            ...line,
            total,
            restock,
          },
        ],
        ...line,
        totalRefund: total,
        refundMethod: pending.sale.payments[0]!.method,
        reason,
        processedBy: managerId,
        returnedAt,
      };
      saleReturns.push(saleReturn);
      item.returnedQuantity = round3(item.returnedQuantity + pending.quantity);
      pending.sale.status = pending.sale.items.every((it) => it.returnedQuantity >= it.quantity)
        ? 'returned'
        : 'partially_returned';
      if (restock) {
        move(product, 'sale_return', pending.quantity, returnedAt, managerId, {
          model: 'SaleReturn',
          id: saleReturn._id,
        });
      }
    }

    // 3. Sales through the day.
    const footfall =
      BASE_BILLS_PER_DAY *
      WEEKDAY_FACTOR[date.getUTCDay()]! *
      (date.getUTCDate() <= 7 ? 1.15 : date.getUTCDate() >= 25 ? 0.92 : 1) *
      festival.footfall *
      (0.92 + 0.16 * t);
    const weights = products.map(({ def }) => {
      if (def.deadForDays && daysLeft < def.deadForDays) return 0;
      const seasonal = def.season ? SEASON_FACTOR[def.season][monthIndex]! : 1;
      const festive = def.season === 'festival' ? festival.festiveGoods : 1;
      return def.popularity * seasonal * festive * trendFactor(def.trend, t);
    });

    interface Basket {
      minutes: number;
      customer?: SeedCustomer;
      bulk: boolean;
    }
    const baskets: Basket[] = [];
    const billCount = rng.poisson(footfall);
    for (let i = 0; i < billCount; i++) {
      // Two peaks: late morning and evening.
      const minutes = rng.chance(0.4)
        ? rng.int(9 * 60 + 30, 13 * 60)
        : rng.int(16 * 60 + 30, 21 * 60 + 30);
      const regular = rng.chance(0.3) ? individuals[rng.weightedIndex(customerWeights)] : undefined;
      // Customers who registered later shop as anonymous walk-ins before that.
      const customer =
        regular && regular.createdAt.getTime() <= at(day, minutes).getTime() ? regular : undefined;
      baskets.push({ minutes, customer, bulk: false });
    }
    BUSINESS_CUSTOMERS.forEach((b, i) => {
      if (rng.chance(b.visitsPerWeek / 7)) {
        baskets.push({ minutes: rng.int(10 * 60, 12 * 60), customer: businesses[i], bulk: true });
      }
    });
    baskets.sort((a, b) => a.minutes - b.minutes);

    for (const basket of baskets) {
      const soldAt = at(day, basket.minutes);
      if (!happened(soldAt)) break;

      const interState = !!basket.customer && basket.customer.stateCode !== SHOP.stateCode;
      const lineCount = basket.bulk
        ? rng.int(4, 9)
        : Math.min(8, 1 + rng.poisson(MEAN_LINES_PER_BILL - 1));
      const available = [...weights];
      const lines: { product: ProductState; quantity: number }[] = [];
      for (let l = 0; l < lineCount; l++) {
        const index = rng.weightedIndex(available);
        if (index < 0) break;
        available[index] = 0;
        const product = products[index]!;
        let quantity = rng.pick(product.def.quantities ?? DEFAULT_QUANTITIES);
        if (basket.bulk) quantity *= rng.int(4, 10);
        quantity = Math.min(
          quantity,
          product.doc.unit === 'kg' ? product.doc.stock : Math.floor(product.doc.stock),
        );
        if (quantity > 0) lines.push({ product, quantity: round3(quantity) }); // otherwise: lost sale
      }
      if (lines.length === 0) continue;

      const discountLine = rng.chance(0.08) ? rng.int(0, lines.length - 1) : -1;
      const items: SeedSaleItem[] = [];
      const amounts: LineAmounts[] = [];
      lines.forEach(({ product, quantity }, l) => {
        const gross = Math.round(product.doc.sellingPrice * quantity);
        const discount =
          l === discountLine && gross >= 10_000 ? Math.floor((gross * 0.05) / 100) * 100 : 0;
        const line = calculateLine(
          {
            unitPrice: product.doc.sellingPrice,
            quantity,
            discount,
            gstRate: product.doc.gstRate,
            taxInclusive: true,
          },
          interState,
        );
        amounts.push(line);
        items.push({
          product: product.doc._id,
          name: product.doc.name,
          sku: product.doc.sku,
          hsnCode: product.doc.hsnCode,
          unit: product.doc.unit,
          quantity,
          unitPrice: product.doc.sellingPrice,
          taxInclusive: true,
          gstRate: product.doc.gstRate,
          discount: line.discount,
          taxable: line.taxable,
          cgst: line.cgst,
          sgst: line.sgst,
          igst: line.igst,
          total: line.total,
          unitCost: product.doc.costPrice,
          returnedQuantity: 0,
        });
      });

      const totals = calculateInvoiceTotals(amounts);
      const method: PaymentMethod = basket.bulk
        ? rng.pick(['upi', 'card'] as const)
        : PAYMENT_WEIGHTS[rng.weightedIndex(PAYMENT_WEIGHTS.map(([, w]) => w))]![0];
      const customer = basket.customer;
      const sale: SeedSale = {
        _id: newId(soldAt),
        invoiceNumber: nextNumber('invoice', 'INV', soldAt),
        ...(customer && {
          customer: customer._id,
          customerSnapshot: {
            name: customer.name,
            phone: customer.phone,
            ...(customer.gstin && { gstin: customer.gstin }),
            stateCode: customer.stateCode,
          },
        }),
        placeOfSupply: customer?.stateCode ?? SHOP.stateCode,
        interState,
        items,
        gross: totals.gross,
        discount: totals.discount,
        taxable: totals.taxable,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        totalTax: totals.totalTax,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,
        payments: [
          {
            method,
            amount: totals.grandTotal,
            ...(method === 'upi' && { reference: rng.string(12, '0123456789') }),
            ...(method === 'card' && { reference: rng.string(6) }),
          },
        ],
        status: 'completed',
        cashier: basket.bulk ? managerId : cashierIds[rng.chance(0.6) ? 0 : 1]!,
        soldAt,
      };
      sales.push(sale);
      for (const { product, quantity } of lines) {
        move(product, 'sale', -quantity, soldAt, sale.cashier, { model: 'Sale', id: sale._id });
      }

      // About 1 in 150 bills comes back in the next few days.
      if (!basket.bulk && rng.chance(1 / 150)) {
        const itemIndex = rng.int(0, items.length - 1);
        const item = items[itemIndex]!;
        const quantity = item.unit === 'kg' ? item.quantity : rng.int(1, Math.floor(item.quantity));
        const returnDay = dayIndex + rng.int(1, 4);
        const list = returnsByDay.get(returnDay) ?? [];
        list.push({ sale, itemIndex, quantity });
        returnsByDay.set(returnDay, list);
      }
    }

    // 4. Occasional write-offs and stock-count corrections at closing.
    const closingTime = at(day, 21 * 60 + 40);
    if (happened(closingTime) && rng.chance(0.05)) {
      const candidates = products.filter((p) => p.doc.stock >= 3 && p.doc.unit !== 'kg');
      if (candidates.length > 0) {
        const product = rng.pick(candidates);
        const { reason, note } = rng.pick(ADJUSTMENTS);
        const quantity = reason === 'count' && rng.chance(0.3) ? 1 : -rng.int(1, 2);
        move(product, 'adjustment', quantity, closingTime, managerId, undefined, note, reason);
      }
    }

    // 5. Reorder anything at or below its reorder level, one purchase order per supplier.
    const orderTime = at(day, 21 * 60 + 50);
    if (!happened(orderTime)) continue;
    const toOrder = products.filter(
      (p) =>
        !p.onOrder &&
        // Dead-stock items stop being reordered once demand dies, leaving unsold stock behind.
        !(p.def.deadForDays && daysLeft < p.def.deadForDays) &&
        !(p.def.lowStockDemo && daysLeft < LOW_STOCK_DEMO_DAYS) &&
        p.doc.stock <= p.doc.reorderLevel,
    );
    const bySupplier = new Map<number, ProductState[]>();
    for (const p of toOrder)
      bySupplier.set(p.supplierIndex, [...(bySupplier.get(p.supplierIndex) ?? []), p]);
    for (const [sIndex, items] of bySupplier) {
      const supplier = suppliers[sIndex]!;
      const interState = supplier.stateCode !== SHOP.stateCode;
      const poItems = items.map((p) => {
        const gst = calculateGst(
          Math.round(p.doc.costPrice * p.doc.reorderQuantity),
          p.doc.gstRate,
          interState,
        );
        p.onOrder = true;
        return {
          product: p.doc._id,
          name: p.doc.name,
          quantity: p.doc.reorderQuantity,
          receivedQuantity: 0,
          unitCost: p.doc.costPrice,
          gstRate: p.doc.gstRate,
          taxable: gst.taxable,
          cgst: gst.cgst,
          sgst: gst.sgst,
          igst: gst.igst,
          total: gst.total,
        };
      });
      const arrivalDay = dayIndex + supplier.leadTimeDays + rng.int(0, 1);
      const sum = (key: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'total') =>
        poItems.reduce((acc, item) => acc + item[key], 0);
      const po: SeedPurchaseOrder = {
        _id: newId(orderTime),
        poNumber: nextNumber('purchaseOrder', 'PO', orderTime),
        supplier: supplier._id,
        status: 'ordered',
        items: poItems,
        interState,
        taxable: sum('taxable'),
        cgst: sum('cgst'),
        sgst: sum('sgst'),
        igst: sum('igst'),
        total: sum('total'),
        orderedAt: orderTime,
        expectedAt: at(firstDay + arrivalDay * DAY_MS, 8 * 60 + 30),
        receipts: [],
        createdBy: managerId,
      };
      purchaseOrders.push(po);
      receipts.push({ po, day: arrivalDay });
    }
  }

  return {
    settings,
    users,
    categories,
    suppliers,
    products: products.map((p) => p.doc),
    customers: [...individuals, ...businesses],
    purchaseOrders,
    sales,
    saleReturns,
    stockMovements,
    counters: [...counters].map(([_id, seq]) => ({ _id, seq })),
  };
}
