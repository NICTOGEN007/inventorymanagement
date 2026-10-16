import {
  allowsFractions,
  calculateGst,
  formatINR,
  getStateName,
  istDateKey,
  purchaseOrderInputSchema,
  rupeesToPaise,
  type GstRate,
  type Paginated,
  type ProductDto,
  type PurchaseOrderDto,
} from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackagePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ProductPicker } from '@/components/ProductPicker';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateFromNow, istDateInput, paiseToInput } from '@/lib/format';
import { useSettings, useSuppliers } from '@/lib/queries';

interface Line {
  product: { id: string; name: string; sku: string; unit: ProductDto['unit']; gstRate: number };
  quantity: string;
  /** Rupees as typed, excluding GST. */
  unitCost: string;
}

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const QUANTITY = /^\d+(\.\d{1,3})?$/;

export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const existing = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => apiFetch<{ purchaseOrder: PurchaseOrderDto }>(`/purchase-orders/${id}`),
    enabled: !!id,
  });
  if (id && existing.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading purchase order" />
      </div>
    );
  }
  if (id && existing.isError)
    return <ErrorAlert>Could not load the order. {(existing.error as Error).message}</ErrorAlert>;
  const po = existing.data?.purchaseOrder;
  if (po && po.status !== 'draft')
    return (
      <ErrorAlert>
        Only draft orders can be edited. {po.poNumber} has already been placed.
      </ErrorAlert>
    );
  return <PurchaseOrderForm key={id ?? 'new'} order={po} />;
}

function PurchaseOrderForm({ order }: { order?: PurchaseOrderDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState(order?.supplier.id ?? '');
  const [expectedAt, setExpectedAt] = useState(
    order?.expectedAt ? istDateKey(new Date(order.expectedAt)) : '',
  );
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(
    order?.items.map((i) => ({
      product: { ...i.product, gstRate: i.gstRate },
      quantity: String(i.quantity),
      unitCost: paiseToInput(i.unitCost),
    })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingLowStock, setLoadingLowStock] = useState(false);

  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  const interState =
    !!supplier && !!settings.data && supplier.stateCode !== settings.data.stateCode;

  const amounts = lines.map((line) => {
    const qty = Number(line.quantity);
    const cost = AMOUNT.test(line.unitCost.trim()) ? rupeesToPaise(Number(line.unitCost)) : NaN;
    if (!QUANTITY.test(line.quantity.trim()) || !(qty > 0) || Number.isNaN(cost)) return null;
    return calculateGst(Math.round(cost * qty), line.product.gstRate as GstRate, interState);
  });
  const totals = amounts.reduce(
    (acc, a) =>
      a
        ? {
            taxable: acc.taxable + a.taxable,
            tax: acc.tax + a.totalTax,
            total: acc.total + a.total,
          }
        : acc,
    { taxable: 0, tax: 0, total: 0 },
  );

  const addProduct = (p: ProductDto, quantity = '') =>
    setLines((current) =>
      current.some((l) => l.product.id === p.id)
        ? current
        : [
            ...current,
            {
              product: { id: p.id, name: p.name, sku: p.sku, unit: p.unit, gstRate: p.gstRate },
              quantity,
              unitCost: paiseToInput(p.costPrice),
            },
          ],
    );

  /** Fills in this supplier's products that are low or out and not already on order. */
  const addLowStock = async () => {
    if (!supplierId) return;
    setLoadingLowStock(true);
    try {
      const [low, out] = await Promise.all(
        ['low', 'out'].map((stock) =>
          apiFetch<Paginated<ProductDto>>(
            `/products?${new URLSearchParams({ supplier: supplierId, stock, pageSize: '100' })}`,
          ),
        ),
      );
      const candidates = [...out!.data, ...low!.data].filter(
        (p) => p.onOrder === 0 && !lines.some((l) => l.product.id === p.id),
      );
      candidates.forEach((p) => addProduct(p, String(p.reorderQuantity)));
      toast[candidates.length ? 'success' : 'info'](
        candidates.length
          ? `Added ${candidates.length} low-stock ${candidates.length === 1 ? 'product' : 'products'}`
          : 'Nothing from this supplier needs reordering',
      );
    } finally {
      setLoadingLowStock(false);
    }
  };

  const save = useMutation({
    mutationFn: (place: boolean) => {
      const body = {
        supplier: supplierId,
        items: lines.map((l) => ({
          product: l.product.id,
          quantity: Number(l.quantity),
          unitCost: rupeesToPaise(Number(l.unitCost)),
        })),
        ...(expectedAt && { expectedAt }),
        notes,
        place,
      };
      return order
        ? apiFetch<{ purchaseOrder: PurchaseOrderDto }>(`/purchase-orders/${order.id}`, {
            method: 'PUT',
            body,
          })
        : apiFetch<{ purchaseOrder: PurchaseOrderDto }>('/purchase-orders', {
            method: 'POST',
            body,
          });
    },
    onSuccess: ({ purchaseOrder }, place) => {
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.setQueryData(['purchase-order', purchaseOrder.id], { purchaseOrder });
      toast.success(
        place
          ? `${purchaseOrder.poNumber} placed with ${purchaseOrder.supplier.name}`
          : `Draft ${purchaseOrder.poNumber} saved`,
      );
      navigate(`/purchases/${purchaseOrder.id}`);
    },
    onError: (err) => {
      if (!(err instanceof ApiError) || !Array.isArray(err.details)) return;
      setErrors(issuesToErrors(err.details as { path?: unknown[]; message?: string }[]));
    },
  });

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!supplierId) next.supplier = 'Choose a supplier';
    if (lines.length === 0) next.items = 'Add at least one product';
    lines.forEach((line, i) => {
      const qty = Number(line.quantity);
      if (!QUANTITY.test(line.quantity.trim()) || !(qty > 0))
        next[`items.${i}.quantity`] = 'Enter a quantity';
      else if (!allowsFractions(line.product.unit) && !Number.isInteger(qty))
        next[`items.${i}.quantity`] = `Whole ${line.product.unit} only`;
      if (!AMOUNT.test(line.unitCost.trim())) next[`items.${i}.unitCost`] = 'Enter a cost';
    });
    if (Object.keys(next).length === 0) {
      const parsed = purchaseOrderInputSchema.safeParse({
        supplier: supplierId,
        items: lines.map((l) => ({
          product: l.product.id,
          quantity: Number(l.quantity),
          unitCost: rupeesToPaise(Number(l.unitCost)),
        })),
        ...(expectedAt && { expectedAt }),
        notes,
      });
      if (!parsed.success) Object.assign(next, issuesToErrors(parsed.error.issues));
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = (place: boolean) => validate() && save.mutate(place);
  const generalError =
    save.error && !(save.error instanceof ApiError && Array.isArray(save.error.details))
      ? (save.error as Error).message
      : null;
  const backTo = order ? `/purchases/${order.id}` : '/purchases';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {order ? `Back to ${order.poNumber}` : 'Purchases'}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {order ? `Edit draft ${order.poNumber}` : 'New purchase order'}
        </h1>
      </div>

      {generalError && <ErrorAlert>{generalError}</ErrorAlert>}

      <Card className="p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Supplier"
            error={errors.supplier}
            hint={
              supplier &&
              `${getStateName(supplier.stateCode)} · ${interState ? 'IGST (another state)' : 'CGST + SGST (same state)'} · delivers in ${supplier.leadTimeDays} ${supplier.leadTimeDays === 1 ? 'day' : 'days'}`
            }
          >
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose…</option>
              {suppliers.data
                ?.filter((s) => s.isActive || s.id === order?.supplier.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Expected delivery (optional)"
            error={errors.expectedAt}
            hint={
              supplier && !expectedAt
                ? `If empty: ${formatDateFromNow(supplier.leadTimeDays)} once placed`
                : undefined
            }
          >
            <Input
              type="date"
              min={istDateInput()}
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Items</h2>
          <Button
            variant="secondary"
            size="sm"
            disabled={!supplierId}
            loading={loadingLowStock}
            onClick={addLowStock}
          >
            <PackagePlus className="size-4" aria-hidden />
            Add low-stock items
          </Button>
        </div>
        <div className="mt-3">
          <ProductPicker
            excludeIds={lines.map((l) => l.product.id)}
            onSelect={(p) => addProduct(p)}
            placeholder="Add a product by name, SKU or barcode"
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
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Product
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Quantity
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Cost / unit (excl. GST)
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    GST
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Total
                  </th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {lines.map((line, i) => {
                  const a = amounts[i];
                  const update = (patch: Partial<Line>) => {
                    setLines((current) =>
                      current.map((l, j) => (j === i ? { ...l, ...patch } : l)),
                    );
                    setErrors(
                      ({ [`items.${i}.quantity`]: _q, [`items.${i}.unitCost`]: _c, ...rest }) =>
                        rest,
                    );
                  };
                  return (
                    <tr key={line.product.id} className="align-top">
                      <td className="py-3 pr-3">
                        <div className="font-medium">{line.product.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {line.product.sku}
                        </div>
                        {errors[`items.${i}.product`] && (
                          <p className="mt-1 text-xs text-rose-600">
                            {errors[`items.${i}.product`]}
                          </p>
                        )}
                      </td>
                      <td className="w-32 py-3 pr-3">
                        <div className="flex items-center gap-1.5">
                          <Input
                            aria-label={`Quantity of ${line.product.name}`}
                            inputMode="decimal"
                            invalid={!!errors[`items.${i}.quantity`]}
                            value={line.quantity}
                            onChange={(e) => update({ quantity: e.target.value })}
                          />
                          <span className="text-xs text-slate-500">{line.product.unit}</span>
                        </div>
                        {errors[`items.${i}.quantity`] && (
                          <p className="mt-1 text-xs text-rose-600">
                            {errors[`items.${i}.quantity`]}
                          </p>
                        )}
                      </td>
                      <td className="w-40 py-3 pr-3">
                        <MoneyInput
                          aria-label={`Cost per unit of ${line.product.name}`}
                          invalid={!!errors[`items.${i}.unitCost`]}
                          value={line.unitCost}
                          onChange={(e) => update({ unitCost: e.target.value })}
                        />
                        {errors[`items.${i}.unitCost`] && (
                          <p className="mt-1 text-xs text-rose-600">
                            {errors[`items.${i}.unitCost`]}
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right whitespace-nowrap tabular-nums">
                        <div>{a ? formatINR(a.totalTax) : '—'}</div>
                        <div className="text-xs text-slate-500">{line.product.gstRate}%</div>
                      </td>
                      <td className="py-3 pr-3 text-right font-medium whitespace-nowrap tabular-nums">
                        {a ? formatINR(a.total) : '—'}
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

        <dl className="mt-6 ml-auto max-w-xs space-y-1.5 text-sm" aria-label="Order totals">
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">Before GST</dt>
            <dd className="tabular-nums">{formatINR(totals.taxable)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500 dark:text-slate-400">
              {interState ? 'IGST' : 'CGST + SGST'}
            </dt>
            <dd className="tabular-nums">{formatINR(totals.tax)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold dark:border-slate-800">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatINR(totals.total)}</dd>
          </div>
        </dl>
      </Card>

      <Card className="p-6">
        <Field label="Notes for the supplier (optional)" error={errors.notes}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Link to={backTo} className={buttonClass({ variant: 'secondary' })}>
          Cancel
        </Link>
        <Button
          variant="secondary"
          loading={save.isPending && save.variables === false}
          disabled={save.isPending}
          onClick={() => submit(false)}
        >
          Save as draft
        </Button>
        <Button
          loading={save.isPending && save.variables === true}
          disabled={save.isPending}
          onClick={() => submit(true)}
        >
          Place order
        </Button>
      </div>
    </div>
  );
}

/** "items.0.quantity" style keys for line errors; "supplier", "items", "notes" otherwise. */
function issuesToErrors(issues: { path?: unknown[]; message?: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = (issue.path ?? []).map(String).join('.') || 'items';
    if (issue.message && !out[key]) out[key] = issue.message;
  }
  return out;
}
