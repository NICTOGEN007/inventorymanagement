import {
  allowsFractions,
  calculateInvoiceTotals,
  calculateLine,
  formatINR,
  type CustomerSummaryDto,
  type GstRate,
  type InvoiceTotals,
  type LineAmounts,
  type PaymentMethod,
  type ProductDto,
} from '@ims/shared';
import { formatQuantity } from '@/lib/format';

/** One line of the bill being rung up. Quantities and discounts are kept as typed. */
export interface CartLine {
  product: ProductDto;
  quantity: string;
  /** Rupees, e.g. "10" or "2.50"; empty for none. */
  discount: string;
}

export type PayMode = PaymentMethod | 'split';

export interface PaymentState {
  mode: PayMode;
  /** Cash handed over; empty means exactly the bill. */
  cashReceived: string;
  /** UPI transaction id or card approval code for a single payment. */
  reference: string;
  split: Record<PaymentMethod, string>;
}

export interface Cart {
  lines: CartLine[];
  customer?: CustomerSummaryDto;
  payment: PaymentState;
  /** Sent with the bill so a resend cannot bill twice; new for every bill. */
  clientRef: string;
}

export interface EvaluatedLine {
  line: CartLine;
  quantity?: number;
  discount: number;
  amounts?: LineAmounts;
  error?: string;
}

const newRef = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `bill-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function emptyCart(): Cart {
  return {
    lines: [],
    payment: {
      mode: 'cash',
      cashReceived: '',
      reference: '',
      split: { cash: '', upi: '', card: '' },
    },
    clientRef: newRef(),
  };
}

/** Rupee text to paise; undefined when it is not a valid amount. */
export function parseRupees(text: string): number | undefined {
  const trimmed = text.trim().replace(/,/g, '');
  if (trimmed === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return undefined;
  return Math.round(Number(trimmed) * 100);
}

/** Checks a line against the product's unit and stock and works out its tax. */
export function evaluateLine(line: CartLine, interState: boolean): EvaluatedLine {
  const { product } = line;
  const quantity = Number(line.quantity);
  const discount = parseRupees(line.discount);
  if (!line.quantity.trim() || !(quantity > 0)) {
    return { line, discount: 0, error: 'Enter a quantity' };
  }
  if (!allowsFractions(product.unit) && !Number.isInteger(quantity)) {
    return { line, discount: 0, error: `Whole ${product.unit} only` };
  }
  if (Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) {
    return { line, discount: 0, error: 'At most 3 decimal places' };
  }
  if (quantity > product.stock + 1e-9) {
    return {
      line,
      quantity,
      discount: 0,
      error: `Only ${formatQuantity(product.stock, product.unit)} in stock`,
    };
  }
  if (discount === undefined) return { line, quantity, discount: 0, error: 'Invalid discount' };
  const gross = Math.round(product.sellingPrice * quantity);
  if (discount > gross) {
    return { line, quantity, discount, error: `Discount is more than ${formatINR(gross)}` };
  }
  const amounts = calculateLine(
    {
      unitPrice: product.sellingPrice,
      quantity,
      discount,
      gstRate: product.gstRate as GstRate,
      taxInclusive: product.taxInclusive,
    },
    interState,
  );
  return { line, quantity, discount, amounts };
}

export function cartTotals(lines: readonly EvaluatedLine[]): InvoiceTotals {
  return calculateInvoiceTotals(lines.flatMap((l) => (l.amounts ? [l.amounts] : [])));
}

/** Adds a product, or one more of it if it is already on the bill (e.g. scanned twice). */
export function addProduct(lines: readonly CartLine[], product: ProductDto): CartLine[] {
  const existing = lines.findIndex((l) => l.product.id === product.id);
  if (existing === -1) return [...lines, { product, quantity: '1', discount: '' }];
  return lines.map((l, i) => {
    if (i !== existing) return l;
    const current = Number(l.quantity);
    return { ...l, product, quantity: String(Number.isFinite(current) ? current + 1 : 1) };
  });
}

export interface PaymentPlan {
  payments?: { method: PaymentMethod; amount: number; reference?: string }[];
  /** Cash to hand back, in paise. */
  change: number;
  error?: string;
}

/** Turns what the cashier entered into the payments sent with the bill. */
export function planPayments(state: PaymentState, total: number): PaymentPlan {
  if (state.mode === 'split') {
    const parts: { method: PaymentMethod; amount: number }[] = [];
    for (const method of ['cash', 'upi', 'card'] as const) {
      const amount = parseRupees(state.split[method]);
      if (amount === undefined) return { change: 0, error: 'Enter amounts like 250 or 99.50' };
      if (amount > 0) parts.push({ method, amount });
    }
    const paid = parts.reduce((sum, p) => sum + p.amount, 0);
    if (paid !== total) {
      return {
        change: 0,
        error:
          paid < total
            ? `${formatINR(total - paid)} still to pay`
            : `${formatINR(paid - total)} more than the bill`,
      };
    }
    return { payments: parts, change: 0 };
  }

  if (state.mode === 'cash') {
    const received = state.cashReceived.trim() ? parseRupees(state.cashReceived) : total;
    if (received === undefined) return { change: 0, error: 'Enter the cash received' };
    if (received < total) {
      return { change: 0, error: `Cash received is ${formatINR(total - received)} short` };
    }
    return { payments: [{ method: 'cash', amount: total }], change: received - total };
  }

  const reference = state.reference.trim();
  return {
    payments: [{ method: state.mode, amount: total, ...(reference && { reference }) }],
    change: 0,
  };
}

const STORAGE_KEY = 'ims.pos.cart.v1';

/** The open bill survives a page reload in this tab; it is never shared between tabs. */
export function loadCart(): Cart | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const cart = JSON.parse(raw) as Cart;
    return Array.isArray(cart.lines) && cart.payment && cart.clientRef ? cart : undefined;
  } catch {
    return undefined;
  }
}

export function saveCart(cart: Cart) {
  try {
    if (cart.lines.length === 0 && !cart.customer) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Storage may be full or blocked; the bill still works, it just won't survive a reload.
  }
}
