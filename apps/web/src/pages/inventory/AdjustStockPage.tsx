import {
  ADJUSTMENT_REASON_LABELS,
  ADJUSTMENT_REASONS,
  allowsFractions,
  formatINR,
  stockAdjustmentSchema,
  type AdjustmentReason,
  type AdjustmentResult,
  type ProductDto,
} from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { ProductPicker } from '@/components/ProductPicker';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatChange, formatQuantity } from '@/lib/format';
import { INVENTORY_TABS } from './tabs';

const REASON_HINTS: Record<AdjustmentReason, string> = {
  count: 'Enter what you counted on the shelf; the difference is recorded.',
  damaged: 'Remove broken, leaking or spoiled items.',
  expired: 'Remove items past their expiry date.',
  lost: 'Remove items that are missing or stolen.',
  other: 'Add or remove stock for another reason; explain it in the note.',
};

interface Line {
  product: ProductDto;
  /** As typed. Count: the counted quantity. Write-offs: how many to remove. Other: a signed change. */
  quantity: string;
}

interface Computed {
  value: number | null;
  after: number | null;
  change: number | null;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function compute(line: Line, reason: AdjustmentReason): Computed {
  const text = line.quantity.trim().replace(/^\+/, '');
  const value = text === '' ? NaN : Number(text);
  if (!Number.isFinite(value)) return { value: null, after: null, change: null };
  const stock = line.product.stock;
  if (reason === 'count') return { value, after: value, change: round3(value - stock) };
  const change = reason === 'other' ? value : -Math.abs(value);
  return { value, after: round3(stock + change), change };
}

export function AdjustStockPage() {
  // "Adjust stock" from a product page arrives with ?product=<id>; start with that product.
  const [searchParams] = useSearchParams();
  const preselectId = searchParams.get('product');
  const preselected = useQuery({
    queryKey: ['product', preselectId],
    queryFn: () => apiFetch<{ product: ProductDto }>(`/products/${preselectId}`),
    enabled: !!preselectId,
  });
  if (preselectId && preselected.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading product" />
      </div>
    );
  }
  const initial = preselected.data?.product;
  return <AdjustStockForm key={initial?.id ?? 'empty'} initialProduct={initial} />;
}

function AdjustStockForm({ initialProduct }: { initialProduct?: ProductDto }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<AdjustmentReason>('count');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(
    initialProduct ? [{ product: initialProduct, quantity: '' }] : [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<AdjustmentResult | null>(null);

  const computed = lines.map((line) => compute(line, reason));
  const showValue = lines.every((l) => l.product.costPrice !== undefined);
  const valueChange = lines.reduce(
    (sum, line, i) => sum + Math.round((computed[i]!.change ?? 0) * (line.product.costPrice ?? 0)),
    0,
  );

  const save = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch<AdjustmentResult>('/inventory/adjustments', { method: 'POST', body }),
    onSuccess: (data) => {
      setResult(data);
      setReviewing(false);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['product'] });
      void queryClient.invalidateQueries({ queryKey: ['movements'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(
        `Stock adjusted for ${data.adjusted.length} ${data.adjusted.length === 1 ? 'product' : 'products'}`,
      );
    },
    onError: (err) => {
      setReviewing(false);
      if (err instanceof ApiError && Array.isArray(err.details))
        setErrors(issuesToErrors(err.details));
    },
  });

  const payload = () => ({
    reason,
    note,
    items: lines.map((line, i) => ({
      product: line.product.id,
      mode: reason === 'count' ? 'set' : 'change',
      quantity:
        computed[i]!.value === null
          ? NaN
          : reason === 'count'
            ? computed[i]!.value
            : computed[i]!.change,
    })),
  });

  /** Same rules as the API, plus whole-number units and "not below zero", before anything is sent. */
  const validate = (): boolean => {
    const next: Record<string, string> = {};
    lines.forEach((line, i) => {
      const c = computed[i]!;
      if (c.value === null) next[`items.${i}`] = 'Enter a quantity';
      else if (!allowsFractions(line.product.unit) && !Number.isInteger(c.value)) {
        next[`items.${i}`] = `Counted in whole ${line.product.unit}`;
      } else if (c.after !== null && c.after < 0)
        next[`items.${i}`] =
          `Only ${formatQuantity(line.product.stock, line.product.unit)} in stock`;
    });
    const parsed = stockAdjustmentSchema.safeParse(payload());
    if (!parsed.success) Object.assign(next, issuesToErrors(parsed.error.issues), next);
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const reset = () => {
    setLines([]);
    setNote('');
    setErrors({});
    setResult(null);
    save.reset();
  };

  if (result) {
    return (
      <div className="space-y-6">
        <PageHeader title="Inventory" tabs={INVENTORY_TABS.filter((t) => can(t.permission))} />
        <Card className="mx-auto max-w-2xl p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-6 text-emerald-500" aria-hidden />
            <h2 className="text-lg font-semibold">Stock adjusted</h2>
          </div>
          <ul className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {result.adjusted.map((a) => (
              <li key={a.product.id} className="flex items-center justify-between gap-4 py-2">
                <Link
                  to={`/products/${a.product.id}`}
                  className="font-medium hover:text-indigo-600"
                >
                  {a.product.name}
                </Link>
                <span className="flex items-center gap-2 tabular-nums">
                  {a.before} <ArrowRight className="size-3.5 text-slate-400" aria-label="to" />{' '}
                  {a.after}
                </span>
              </li>
            ))}
          </ul>
          {result.unchanged.length > 0 && (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              Already correct, nothing recorded: {result.unchanged.map((u) => u.name).join(', ')}.
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={reset}>New adjustment</Button>
            <Link
              to="/inventory/movements?type=adjustment"
              className={buttonClass({ variant: 'secondary' })}
            >
              View in stock history
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const quantityLabel =
    reason === 'count' ? 'Counted' : reason === 'other' ? 'Change (+/−)' : 'Remove';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Correct stock after a count, or write off damaged, expired or lost items."
        tabs={INVENTORY_TABS.filter((t) => can(t.permission))}
      />

      <Card className="p-6">
        <fieldset>
          <legend className="text-base font-semibold">Reason</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {ADJUSTMENT_REASONS.map((r) => (
              <label
                key={r}
                className={cn(
                  'cursor-pointer rounded-lg border p-3 text-sm',
                  reason === r
                    ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-500/10'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700',
                )}
              >
                <input
                  type="radio"
                  name="reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => {
                    setReason(r);
                    // The number means something different for each reason, so start afresh.
                    setLines((current) => current.map((l) => ({ ...l, quantity: '' })));
                    setErrors({});
                  }}
                  className="sr-only"
                />
                <span className="font-medium">{ADJUSTMENT_REASON_LABELS[r]}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{REASON_HINTS[reason]}</p>
        </fieldset>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold">Products</h2>
        <div className="mt-3">
          <ProductPicker
            includeInactive
            excludeIds={lines.map((l) => l.product.id)}
            onSelect={(product) => {
              setLines((current) => [...current, { product, quantity: '' }]);
              setErrors((e) => ({ ...e, items: '' }));
            }}
          />
        </div>
        {errors.items && (
          <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{errors.items}</p>
        )}

        {lines.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Product
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    In stock
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {quantityLabel}
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    After
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {lines.map((line, i) => {
                  const c = computed[i]!;
                  const error = errors[`items.${i}`];
                  return (
                    <tr key={line.product.id} className="align-top">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{line.product.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {line.product.sku}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right whitespace-nowrap tabular-nums">
                        {formatQuantity(line.product.stock, line.product.unit)}
                      </td>
                      <td className="w-40 py-3 pr-4">
                        <Input
                          aria-label={`${quantityLabel} for ${line.product.name}`}
                          inputMode="decimal"
                          invalid={!!error}
                          value={line.quantity}
                          onChange={(e) => {
                            const quantity = e.target.value;
                            setLines((current) =>
                              current.map((l, j) => (j === i ? { ...l, quantity } : l)),
                            );
                            setErrors(({ [`items.${i}`]: _cleared, ...rest }) => rest);
                          }}
                        />
                        {error && (
                          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right whitespace-nowrap tabular-nums">
                        {c.after === null ? (
                          '—'
                        ) : (
                          <>
                            <div className={c.after < 0 ? 'text-rose-600' : ''}>
                              {formatQuantity(c.after, line.product.unit)}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {c.change === 0
                                ? 'no change'
                                : formatChange(c.change!, line.product.unit)}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${line.product.name}`}
                          onClick={() => {
                            setLines((current) => current.filter((_, j) => j !== i));
                            setErrors({});
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 max-w-xl">
          <Field
            label={reason === 'other' ? 'Note (required)' : 'Note (optional)'}
            error={errors.note}
          >
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Monthly shelf count, aisle 3"
            />
          </Field>
        </div>

        {save.error && !(save.error instanceof ApiError && Array.isArray(save.error.details)) && (
          <div className="mt-4">
            <ErrorAlert>
              {save.error instanceof ApiError
                ? save.error.message
                : 'Could not save the adjustment'}
            </ErrorAlert>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {lines.length} {lines.length === 1 ? 'product' : 'products'}
            {showValue && lines.length > 0 && <> · value change at cost {formatINR(valueChange)}</>}
          </p>
          <Button disabled={lines.length === 0} onClick={() => validate() && setReviewing(true)}>
            Review adjustment
          </Button>
        </div>
      </Card>

      <Dialog
        open={reviewing}
        onClose={() => setReviewing(false)}
        title="Apply this adjustment?"
        description={ADJUSTMENT_REASON_LABELS[reason]}
      >
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {lines.map((line, i) => (
            <li key={line.product.id} className="flex justify-between gap-4 py-2">
              <span className="min-w-0 truncate">{line.product.name}</span>
              <span className="shrink-0 tabular-nums">
                {computed[i]!.change === 0
                  ? 'no change'
                  : formatChange(computed[i]!.change ?? 0, line.product.unit)}
              </span>
            </li>
          ))}
        </ul>
        {showValue && (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Value change at cost: {formatINR(valueChange)}
          </p>
        )}
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          This is recorded in the stock history with your name.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setReviewing(false)}>
            Back
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(payload())}>
            Apply adjustment
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** Maps validation issues to keys used by this form: "items.<index>", "items", "note". */
function issuesToErrors(
  issues: { path?: (string | number | symbol)[]; message?: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const [first, index] = issue.path ?? [];
    const key =
      first === 'items' && typeof index === 'number' ? `items.${index}` : String(first ?? 'items');
    if (issue.message && !out[key]) out[key] = issue.message;
  }
  return out;
}
