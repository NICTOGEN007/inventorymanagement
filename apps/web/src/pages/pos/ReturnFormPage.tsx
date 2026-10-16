import {
  allowsFractions,
  calculateReturnTotals,
  formatINR,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  returnableQuantity,
  returnLineAmounts,
  type PaymentMethod,
  type ReturnLineAmounts,
  type SaleDto,
  type SaleItemDto,
  type SaleReturnDto,
} from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { SaleStatusBadge } from '@/components/SaleStatusBadge';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatQuantity } from '@/lib/format';

/** Reasons cashiers pick most; any other reason can be typed. */
const REASONS = ['Damaged or defective', 'Expired', 'Wrong item', 'Changed mind'];

interface LineState {
  quantity: string;
  restock: boolean;
}

interface Evaluated {
  item: SaleItemDto;
  remaining: number;
  quantity?: number;
  amounts?: ReturnLineAmounts;
  error?: string;
}

function evaluate(item: SaleItemDto, state: LineState | undefined): Evaluated {
  const remaining = returnableQuantity(item);
  const text = state?.quantity.trim() ?? '';
  if (!text) return { item, remaining };
  const quantity = Number(text);
  if (!(quantity > 0)) return { item, remaining, error: 'Enter a quantity' };
  if (!allowsFractions(item.product.unit) && !Number.isInteger(quantity)) {
    return { item, remaining, error: `Whole ${item.product.unit} only` };
  }
  if (Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) {
    return { item, remaining, error: 'At most 3 decimal places' };
  }
  if (quantity > remaining + 1e-9) {
    return {
      item,
      remaining,
      error: `Only ${formatQuantity(remaining, item.product.unit)} can be returned`,
    };
  }
  return { item, remaining, quantity, amounts: returnLineAmounts(item, quantity) };
}

const newRef = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `return-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function ReturnFormPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['sales', 'detail', id],
    queryFn: () => apiFetch<{ sale: SaleDto }>(`/sales/${id}`),
    select: (r) => r.sale,
  });

  if (query.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading sale" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorAlert>Could not load this sale. {(query.error as Error).message}</ErrorAlert>;
  }
  return <ReturnForm sale={query.data} />;
}

function ReturnForm({ sale }: { sale: SaleDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>(
    sale.payments[0]?.method ?? 'cash',
  );
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [clientRef] = useState(newRef);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [reasonError, setReasonError] = useState<string>();

  const evaluated = sale.items.map((item) => evaluate(item, lines[item.product.id]));
  const chosen = evaluated.filter((e) => e.amounts);
  const invalid = evaluated.some((e) => e.error);
  const completesSale = evaluated.every((e) => e.remaining - (e.quantity ?? 0) <= 1e-9);
  const totals = calculateReturnTotals(
    chosen.map((e) => e.amounts!),
    sale,
    completesSale,
  );
  const nothingLeft = evaluated.every((e) => e.remaining <= 0);

  const setLine = (productId: string, change: Partial<LineState>) => {
    setLines((current) => ({
      ...current,
      [productId]: { quantity: '', restock: true, ...current[productId], ...change },
    }));
    setServerErrors((e) => {
      const { [productId]: _gone, ...rest } = e;
      return rest;
    });
  };
  const returnEverything = () => {
    setLines(
      Object.fromEntries(
        evaluated
          .filter((e) => e.remaining > 0)
          .map((e) => [
            e.item.product.id,
            { quantity: String(e.remaining), restock: lines[e.item.product.id]?.restock ?? true },
          ]),
      ),
    );
    setServerErrors({});
  };

  const submit = useMutation({
    mutationFn: () =>
      apiFetch<{ saleReturn: SaleReturnDto }>('/returns', {
        method: 'POST',
        body: {
          sale: sale.id,
          items: chosen.map((e) => ({
            product: e.item.product.id,
            quantity: e.quantity,
            restock: lines[e.item.product.id]?.restock ?? true,
          })),
          refundMethod,
          ...(refundMethod !== 'cash' && reference.trim() && { refundReference: reference.trim() }),
          reason: reason.trim(),
          clientRef,
        },
      }),
    onSuccess: ({ saleReturn }) => {
      for (const key of ['sales', 'returns', 'products', 'inventory', 'customers']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(`Credit note ${saleReturn.returnNumber} issued`);
      navigate(`/pos/returns/${saleReturn.id}`, { replace: true });
    },
    onError: (err) => {
      if (!(err instanceof ApiError) || !Array.isArray(err.details)) return;
      const byProduct: Record<string, string> = {};
      for (const issue of err.details as { path?: unknown[]; message?: string }[]) {
        if (issue.path?.[0] === 'items' && typeof issue.path[1] === 'number' && issue.message) {
          const line = chosen[issue.path[1]];
          if (line) byProduct[line.item.product.id] = issue.message;
        }
        if (issue.path?.[0] === 'reason' && issue.message) setReasonError(issue.message);
      }
      setServerErrors(byProduct);
    },
  });
  const lineErrors = Object.keys(serverErrors).length > 0;
  const generalError =
    submit.error && !lineErrors && !reasonError ? (submit.error as Error).message : null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setReasonError('Give a short reason');
      return;
    }
    if (chosen.length === 0 || invalid) return;
    submit.mutate();
  };

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-6">
      <Link
        to={`/pos/sales/${sale.id}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="size-4" aria-hidden /> {sale.invoiceNumber}
      </Link>
      <PageHeader
        title="Return items"
        description={
          <>
            Against {sale.invoiceNumber} · sold {formatDateTime(sale.soldAt)} ·{' '}
            {sale.customer?.name ?? 'Walk-in customer'} <SaleStatusBadge status={sale.status} />
          </>
        }
        actions={
          !nothingLeft && (
            <Button variant="secondary" onClick={returnEverything}>
              Return everything
            </Button>
          )
        }
      />

      {nothingLeft ? (
        <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Everything on this bill has already been returned.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Items on the bill</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Item
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Return
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-3 text-right font-medium sm:table-cell"
                    >
                      Refund
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {evaluated.map((e) => {
                    const { item } = e;
                    const pid = item.product.id;
                    const state = lines[pid];
                    const error = e.error ?? serverErrors[pid];
                    const errorId = `return-${pid}-error`;
                    return (
                      <tr key={pid} className={cn(e.remaining <= 0 && 'opacity-60')}>
                        <td className="min-w-32 px-4 py-3 align-top">
                          <div className="font-medium">{item.product.name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Bought {formatQuantity(item.quantity, item.product.unit)} at{' '}
                            {formatINR(item.unitPrice)}
                            {item.returnedQuantity > 0 &&
                              ` · ${formatQuantity(item.returnedQuantity, item.product.unit)} returned`}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {e.remaining <= 0 ? (
                            <Badge>Returned</Badge>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="w-20">
                                  <Input
                                    inputMode="decimal"
                                    aria-label={`Quantity of ${item.product.name} to return`}
                                    placeholder="0"
                                    value={state?.quantity ?? ''}
                                    invalid={!!error}
                                    aria-describedby={error ? errorId : undefined}
                                    onChange={(ev) => setLine(pid, { quantity: ev.target.value })}
                                  />
                                </div>
                                <span className="text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">
                                  of {formatQuantity(e.remaining, item.product.unit)}
                                </span>
                                {(state?.quantity ?? '') !== String(e.remaining) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Return all ${item.product.name}`}
                                    onClick={() => setLine(pid, { quantity: String(e.remaining) })}
                                  >
                                    All
                                  </Button>
                                )}
                              </div>
                              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                <input
                                  type="checkbox"
                                  className="size-4 rounded border-slate-300 text-indigo-600"
                                  checked={state?.restock ?? true}
                                  onChange={(ev) => setLine(pid, { restock: ev.target.checked })}
                                />
                                Back to stock
                              </label>
                              {error && (
                                <p
                                  id={errorId}
                                  className="text-xs text-rose-600 dark:text-rose-400"
                                >
                                  {error}
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-right align-top whitespace-nowrap tabular-nums sm:table-cell">
                          {e.amounts ? formatINR(e.amounts.total) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="space-y-4 p-5">
              <h2 className="text-sm font-semibold">Refund</h2>
              <dl className="space-y-1.5 text-sm" aria-label="Refund totals">
                <Row label="Taxable value" value={formatINR(totals.taxable)} />
                {sale.interState ? (
                  <Row label="IGST" value={formatINR(totals.igst)} />
                ) : (
                  <>
                    <Row label="CGST" value={formatINR(totals.cgst)} />
                    <Row label="SGST" value={formatINR(totals.sgst)} />
                  </>
                )}
                {chosen.length > 0 && totals.roundOff !== 0 && (
                  <Row
                    label="Round off"
                    value={`${totals.roundOff > 0 ? '+' : '−'}${formatINR(Math.abs(totals.roundOff))}`}
                  />
                )}
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
                  <dt className="font-semibold">To refund</dt>
                  <dd className="text-xl font-semibold">
                    {formatINR(chosen.length > 0 ? totals.totalRefund : 0)}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Refund by</p>
                <div className="grid grid-cols-3 gap-1" role="group" aria-label="Refund by">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={refundMethod === m}
                      onClick={() => setRefundMethod(m)}
                      className={cn(
                        'rounded-lg border px-2 py-2 text-sm font-medium',
                        refundMethod === m
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
              {refundMethod !== 'cash' && (
                <Field
                  label={refundMethod === 'upi' ? 'UPI reference' : 'Card reversal reference'}
                  hint="Optional"
                >
                  <Input
                    value={reference}
                    autoComplete="off"
                    onChange={(e) => setReference(e.target.value)}
                  />
                </Field>
              )}
              <div className="space-y-2">
                <Field label="Reason" error={reasonError}>
                  <Input
                    value={reason}
                    maxLength={300}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setReasonError(undefined);
                    }}
                  />
                </Field>
                <div className="flex flex-wrap gap-1.5">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setReason(r);
                        setReasonError(undefined);
                      }}
                      className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {generalError && <ErrorAlert>{generalError}</ErrorAlert>}
              <Button
                type="submit"
                className="w-full"
                loading={submit.isPending}
                disabled={chosen.length === 0 || invalid}
              >
                <Undo2 className="size-4" aria-hidden />
                {invalid
                  ? 'Check the quantities'
                  : chosen.length > 0
                    ? `Refund ${formatINR(totals.totalRefund)}`
                    : 'Choose items to return'}
              </Button>
            </Card>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              A credit note is issued for the refund. Items marked “Back to stock” go back on the
              shelf; untick it for damaged goods.
            </p>
          </div>
        </div>
      )}
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
