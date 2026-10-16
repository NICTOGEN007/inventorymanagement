import {
  formatINR,
  getStateName,
  PAYMENT_METHOD_LABELS,
  type ProductDto,
  type SaleDto,
} from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ReceiptText, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CustomerPicker } from '@/components/CustomerPicker';
import { ProductPicker } from '@/components/ProductPicker';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatQuantity } from '@/lib/format';
import { useSettings } from '@/lib/queries';
import {
  addProduct,
  cartTotals,
  emptyCart,
  evaluateLine,
  loadCart,
  planPayments,
  saveCart,
  type Cart,
  type CartLine,
  type PayMode,
} from './cart';
import { SaleCompleteDialog } from './SaleCompleteDialog';
import { POS_TABS } from './tabs';

const PAY_MODES: { mode: PayMode; label: string }[] = [
  { mode: 'cash', label: 'Cash' },
  { mode: 'upi', label: 'UPI' },
  { mode: 'card', label: 'Card' },
  { mode: 'split', label: 'Split' },
];

interface Completed {
  sale: SaleDto;
  change: number;
}

export function PosPage() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<Cart>(() => loadCart() ?? emptyCart());
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const pickerBox = useRef<HTMLDivElement>(null);

  /** Ready for the next customer: the scanner types into the product search again. */
  const focusPicker = () =>
    setTimeout(() => {
      const input = pickerBox.current?.querySelector('input');
      input?.blur();
      input?.focus();
    }, 0);

  useEffect(() => saveCart(cart), [cart]);

  const shopState = settings.data?.stateCode;
  const interState =
    !!cart.customer?.stateCode && !!shopState && cart.customer.stateCode !== shopState;
  const lines = cart.lines.map((l) => evaluateLine(l, interState));
  const totals = cartTotals(lines);
  const plan = planPayments(cart.payment, totals.grandTotal);
  const linesValid = lines.length > 0 && lines.every((l) => l.amounts);

  const updateLine = (productId: string, change: Partial<CartLine>) => {
    setLineErrors(({ [productId]: _, ...rest }) => rest);
    setCart((c) => ({
      ...c,
      lines: c.lines.map((l) => (l.product.id === productId ? { ...l, ...change } : l)),
    }));
  };
  const removeLine = (productId: string) => {
    setLineErrors(({ [productId]: _, ...rest }) => rest);
    setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.product.id !== productId) }));
  };
  const setPayment = (change: Partial<Cart['payment']>) =>
    setCart((c) => ({ ...c, payment: { ...c.payment, ...change } }));

  const sale = useMutation({
    mutationFn: () =>
      apiFetch<{ sale: SaleDto }>('/sales', {
        method: 'POST',
        body: {
          items: lines.map((l) => ({
            product: l.line.product.id,
            quantity: l.quantity,
            discount: l.discount,
          })),
          ...(cart.customer && { customer: cart.customer.id }),
          payments: plan.payments,
          clientRef: cart.clientRef,
        },
      }),
    onSuccess: ({ sale: done }) => {
      setCompleted({ sale: done, change: plan.change });
      setCart(emptyCart());
      setLineErrors({});
      void queryClient.invalidateQueries({ queryKey: ['product-picker'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || !Array.isArray(error.details)) return;
      const errors: Record<string, string> = {};
      for (const issue of error.details as { path?: unknown[]; message?: string }[]) {
        const index = issue.path?.[0] === 'items' ? issue.path[1] : undefined;
        const line = typeof index === 'number' ? cart.lines[index] : undefined;
        if (line && issue.message) errors[line.product.id] = issue.message;
      }
      setLineErrors(errors);
      // Someone else sold some of these; refresh their stock on the bill.
      if (error.code === 'INSUFFICIENT_STOCK') {
        for (const productId of Object.keys(errors)) {
          const { product } = await apiFetch<{ product: ProductDto }>(`/products/${productId}`);
          setCart((c) => ({
            ...c,
            lines: c.lines.map((l) => (l.product.id === productId ? { ...l, product } : l)),
          }));
        }
      }
    },
  });

  const canComplete = linesValid && !!plan.payments && !!settings.data && !sale.isPending;
  const complete = () => {
    if (canComplete) sale.mutate();
  };
  // F9 completes the sale from anywhere on the page, as on most billing counters.
  const completeRef = useRef(complete);
  useEffect(() => {
    completeRef.current = complete;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault();
        completeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const generalError =
    sale.error && Object.keys(lineErrors).length === 0 ? sale.error.message : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Point of Sale"
        description="Scan or search products to build the bill, take payment and print the GST invoice."
        tabs={POS_TABS}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <div ref={pickerBox} className="border-b border-slate-200 p-4 dark:border-slate-800">
            <ProductPicker
              autoFocus
              label="Add product"
              placeholder="Scan a barcode or search products"
              onSelect={(product) => {
                setLineErrors(({ [product.id]: _, ...rest }) => rest);
                setCart((c) => ({ ...c, lines: addProduct(c.lines, product) }));
              }}
            />
          </div>

          {lines.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-slate-500 dark:text-slate-400">
              <ReceiptText className="size-8 text-slate-300 dark:text-slate-600" aria-hidden />
              Scan a barcode or search for a product to start a bill.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Items on this bill</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Item
                    </th>
                    <th scope="col" className="px-2 py-3 font-medium">
                      Quantity
                    </th>
                    <th scope="col" className="hidden px-2 py-3 font-medium sm:table-cell">
                      Discount
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="w-10 px-2 py-3">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lines.map(({ line, amounts, error }) => {
                    const { product } = line;
                    const message = lineErrors[product.id] ?? error;
                    return (
                      <tr key={product.id} className="align-top">
                        <td className="min-w-32 px-3 py-3 sm:px-4">
                          <div className="font-medium">{product.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {formatINR(product.sellingPrice)} / {product.unit} ·{' '}
                            {product.taxInclusive ? 'incl.' : '+'} {product.gstRate}% GST ·{' '}
                            {formatQuantity(product.stock, product.unit)} in stock
                          </div>
                          {message && (
                            <p
                              role="alert"
                              className="mt-1 text-xs text-rose-600 dark:text-rose-400"
                            >
                              {message}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-1">
                            <span className="hidden sm:block">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-2"
                                aria-label={`One less ${product.name}`}
                                disabled={!(Number(line.quantity) > 1)}
                                onClick={() =>
                                  updateLine(product.id, {
                                    quantity: String(Math.max(1, Number(line.quantity) - 1)),
                                  })
                                }
                              >
                                <Minus className="size-4" aria-hidden />
                              </Button>
                            </span>
                            <div className="w-16 shrink-0 sm:w-20">
                              <Input
                                aria-label={`Quantity of ${product.name}`}
                                inputMode="decimal"
                                autoComplete="off"
                                invalid={!!message}
                                className="text-center tabular-nums"
                                value={line.quantity}
                                onChange={(e) =>
                                  updateLine(product.id, { quantity: e.target.value })
                                }
                              />
                            </div>
                            <span className="hidden sm:block">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="px-2"
                                aria-label={`One more ${product.name}`}
                                onClick={() =>
                                  updateLine(product.id, {
                                    quantity: String((Number(line.quantity) || 0) + 1),
                                  })
                                }
                              >
                                <Plus className="size-4" aria-hidden />
                              </Button>
                            </span>
                          </div>
                          <div className="mt-1 text-center text-xs text-slate-500 sm:pl-10 sm:text-left dark:text-slate-400">
                            {product.unit}
                          </div>
                        </td>
                        <td className="hidden w-28 px-2 py-3 sm:table-cell">
                          <MoneyInput
                            aria-label={`Discount on ${product.name}`}
                            placeholder="0"
                            value={line.discount}
                            onChange={(e) => updateLine(product.id, { discount: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                          {amounts ? formatINR(amounts.total) : '—'}
                          {amounts && amounts.discount > 0 && (
                            <div className="text-xs font-normal text-slate-500 line-through dark:text-slate-400">
                              {formatINR(amounts.gross)}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="px-2"
                            aria-label={`Remove ${product.name}`}
                            onClick={() => removeLine(product.id)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex justify-end border-t border-slate-200 p-3 dark:border-slate-800">
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
                  Clear bill
                </Button>
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Customer</h2>
            {cart.customer ? (
              <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <div className="min-w-0">
                  <div className="font-medium">{cart.customer.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {[
                      cart.customer.phone,
                      cart.customer.gstin && `GSTIN ${cart.customer.gstin}`,
                      cart.customer.stateCode && getStateName(cart.customer.stateCode),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {interState && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      Supply to another state: IGST applies.
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  aria-label="Remove customer"
                  onClick={() => setCart((c) => ({ ...c, customer: undefined }))}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <UserRound className="size-4" aria-hidden /> Walk-in customer
                </p>
                <CustomerPicker onSelect={(customer) => setCart((c) => ({ ...c, customer }))} />
              </>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Bill</h2>
            <dl className="space-y-1.5 text-sm" aria-label="Bill totals">
              <TotalRow label={`Items (${lines.length})`} value={formatINR(totals.gross)} />
              {totals.discount > 0 && (
                <TotalRow label="Discount" value={`−${formatINR(totals.discount)}`} />
              )}
              <TotalRow label="Taxable value" value={formatINR(totals.taxable)} muted />
              {interState ? (
                <TotalRow label="IGST" value={formatINR(totals.igst)} muted />
              ) : (
                <>
                  <TotalRow label="CGST" value={formatINR(totals.cgst)} muted />
                  <TotalRow label="SGST" value={formatINR(totals.sgst)} muted />
                </>
              )}
              {totals.roundOff !== 0 && (
                <TotalRow
                  label="Round off"
                  value={`${totals.roundOff > 0 ? '+' : '−'}${formatINR(Math.abs(totals.roundOff))}`}
                  muted
                />
              )}
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
                <dt className="font-semibold">Total</dt>
                <dd className="text-2xl font-semibold tracking-tight">
                  {formatINR(totals.grandTotal)}
                </dd>
              </div>
            </dl>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Payment</h2>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label="Payment method">
              {PAY_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={cart.payment.mode === mode}
                  onClick={() => setPayment({ mode })}
                  className={cn(
                    'rounded-lg border px-2 py-2 text-sm font-medium',
                    cart.payment.mode === mode
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {cart.payment.mode === 'cash' && (
              <Field label="Cash received" hint="Leave empty if the customer paid exactly.">
                <MoneyInput
                  placeholder={(totals.grandTotal / 100).toFixed(0)}
                  value={cart.payment.cashReceived}
                  onChange={(e) => setPayment({ cashReceived: e.target.value })}
                />
              </Field>
            )}
            {(cart.payment.mode === 'upi' || cart.payment.mode === 'card') && (
              <Field
                label={
                  cart.payment.mode === 'upi'
                    ? 'UPI transaction id (optional)'
                    : 'Card approval code (optional)'
                }
              >
                <Input
                  autoComplete="off"
                  value={cart.payment.reference}
                  onChange={(e) => setPayment({ reference: e.target.value })}
                />
              </Field>
            )}
            {cart.payment.mode === 'split' && (
              <div className="space-y-2">
                {(['cash', 'upi', 'card'] as const).map((method) => (
                  <label key={method} className="flex items-center gap-3 text-sm">
                    <span className="w-12 font-medium text-slate-700 dark:text-slate-300">
                      {PAYMENT_METHOD_LABELS[method]}
                    </span>
                    <span className="flex-1">
                      <MoneyInput
                        aria-label={`${PAYMENT_METHOD_LABELS[method]} amount`}
                        placeholder="0"
                        value={cart.payment.split[method]}
                        onChange={(e) =>
                          setPayment({ split: { ...cart.payment.split, [method]: e.target.value } })
                        }
                      />
                    </span>
                  </label>
                ))}
              </div>
            )}

            {lines.length > 0 && plan.error && (
              <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
                {plan.error}
              </p>
            )}
            {plan.change > 0 && (
              <p className="flex justify-between text-sm font-medium" role="status">
                <span>Change to return</span>
                <span className="tabular-nums">{formatINR(plan.change)}</span>
              </p>
            )}
            {generalError && <ErrorAlert>{generalError}</ErrorAlert>}

            <Button
              className="h-12 w-full text-base"
              disabled={!canComplete}
              loading={sale.isPending}
              onClick={complete}
            >
              Complete sale
              <kbd className="rounded border border-white/40 px-1.5 text-xs font-normal">F9</kbd>
            </Button>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this bill?"
        confirmLabel="Clear bill"
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          setCart(emptyCart());
          setLineErrors({});
          setConfirmClear(false);
          focusPicker();
        }}
      >
        All {lines.length} {lines.length === 1 ? 'item' : 'items'} will be removed. Nothing has been
        billed yet.
      </ConfirmDialog>

      <SaleCompleteDialog
        completed={completed}
        onClose={() => {
          setCompleted(null);
          focusPicker();
        }}
      />
    </div>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className={cn(muted && 'text-slate-500 dark:text-slate-400')}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
