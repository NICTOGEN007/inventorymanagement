import {
  allowsFractions,
  formatINR,
  type RestockPlanDto,
  type RestockPlanGroupDto,
  type RestockPlanItemDto,
} from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Info,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { formatRate, lastsLabel, PlanStatusBadge } from '@/components/RestockBadges';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDateTime, formatQuantity, formatRelative } from '@/lib/format';
import { usePrepareRestockPlan, useRestockRefresh } from '@/lib/restock';

const SOURCE_LABELS = {
  manual: 'Prepared on Smart Restock',
  alert: 'Prepared from the dashboard alert',
  assistant: 'Prepared by the AI assistant',
} as const;

type Edits = Record<string, string>;

/** The quantity typed for a line, or an error message. */
function parseQuantity(text: string, unit: RestockPlanItemDto['product']['unit']) {
  const value = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(value) || value <= 0) return 'Enter more than 0';
  if (!allowsFractions(unit) && !Number.isInteger(value)) return `Whole ${unit} only`;
  return value;
}

export function RestockPlanPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const refresh = useRestockRefresh();
  const prepare = usePrepareRestockPlan();
  const [edits, setEdits] = useState<Edits>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const query = useQuery({
    queryKey: ['restock-plan', id],
    queryFn: () => apiFetch<{ plan: RestockPlanDto }>(`/restock/plans/${id}`),
    select: (r) => r.plan,
  });

  const settle = (plan: RestockPlanDto) => {
    queryClient.setQueryData(['restock-plan', plan.id], { plan });
    setEdits({});
    setRemoved(new Set());
    refresh();
  };
  const failed = (fallback: string) => (err: unknown) => {
    toast.error(err instanceof ApiError ? err.message : fallback);
    if (err instanceof ApiError && err.status === 409) {
      void queryClient.invalidateQueries({ queryKey: ['restock-plan', id] });
    }
  };

  const plan = query.data;
  const lines = plan?.groups.flatMap((g) => g.items) ?? [];
  const kept = lines.filter((l) => !removed.has(l.product.id));
  const parsed = kept.map((l) => ({
    line: l,
    value:
      edits[l.product.id] === undefined
        ? l.quantity
        : parseQuantity(edits[l.product.id]!, l.product.unit),
  }));
  const invalid = parsed.some((p) => typeof p.value === 'string');
  const dirty = removed.size > 0 || parsed.some((p) => p.value !== p.line.quantity);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ plan: RestockPlanDto }>(`/restock/plans/${id}`, {
        method: 'PATCH',
        body: { items: parsed.map((p) => ({ product: p.line.product.id, quantity: p.value })) },
      }),
    onSuccess: ({ plan }) => {
      settle(plan);
      toast.success('Changes saved');
    },
    onError: failed('Could not save the changes'),
  });
  const confirm = useMutation({
    mutationFn: () =>
      apiFetch<{ plan: RestockPlanDto }>(`/restock/plans/${id}/confirm`, { method: 'POST' }),
    onSuccess: ({ plan }) => {
      settle(plan);
      setConfirming(false);
      toast.success(
        `${plan.supplierCount} purchase ${plan.supplierCount === 1 ? 'order' : 'orders'} placed`,
      );
    },
    onError: (err) => {
      setConfirming(false);
      failed('Could not confirm the plan')(err);
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      apiFetch<{ plan: RestockPlanDto }>(`/restock/plans/${id}/cancel`, { method: 'POST' }),
    onSuccess: ({ plan }) => {
      settle(plan);
      setCancelling(false);
      toast.success('Plan cancelled');
    },
    onError: (err) => {
      setCancelling(false);
      failed('Could not cancel the plan')(err);
    },
  });

  if (query.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading the restock plan" />
      </div>
    );
  }
  if (query.isError || !plan) {
    return (
      <ErrorAlert>Could not load the plan. {(query.error as Error | null)?.message}</ErrorAlert>
    );
  }

  const editable = plan.status === 'draft' && can('purchases:manage');
  const supplierNames = plan.groups.map((g) => g.supplier.name);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link
          to="/restock/plans"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Restock plans
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">
              Restock plan <span className="whitespace-nowrap">{plan.planNumber}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <PlanStatusBadge status={plan.status} />
              <span>
                {SOURCE_LABELS[plan.source]}
                {plan.createdBy && ` by ${plan.createdBy.name}`}, {formatDateTime(plan.createdAt)}
              </span>
            </div>
          </div>
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              {dirty && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEdits({});
                      setRemoved(new Set());
                    }}
                  >
                    <Undo2 className="size-4" aria-hidden />
                    Undo changes
                  </Button>
                  <Button
                    variant="secondary"
                    loading={save.isPending}
                    disabled={invalid || kept.length === 0}
                    onClick={() => save.mutate()}
                  >
                    <Save className="size-4" aria-hidden />
                    Save changes
                  </Button>
                </>
              )}
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                <XCircle className="size-4" aria-hidden />
                Cancel plan
              </Button>
              <Button disabled={dirty} onClick={() => setConfirming(true)}>
                <CheckCircle2 className="size-4" aria-hidden />
                Confirm &amp; place orders
              </Button>
            </div>
          )}
        </div>
      </div>

      {plan.status === 'draft' && (
        <Callout tone="info" className="flex items-start gap-2">
          <Info
            className="mt-0.5 size-4 shrink-0 text-indigo-600 dark:text-indigo-400"
            aria-hidden
          />
          <p>
            Nothing has been ordered yet. Check the quantities, change any you like, then confirm to
            place one purchase order per supplier. The plan expires {formatRelative(plan.expiresAt)}
            , as stock and sales move on.
            {dirty && ' Save your changes before confirming.'}
          </p>
        </Callout>
      )}
      {plan.status === 'expired' && (
        <Callout tone="warning" className="flex flex-wrap items-center justify-between gap-3">
          <p>
            <span className="font-medium">This plan expired:</span>{' '}
            {plan.expiredReason ?? 'it is out of date'}. Nothing was ordered.
          </p>
          {can('purchases:manage') && (
            <Button size="sm" loading={prepare.isPending} onClick={() => prepare.mutate({})}>
              <Sparkles className="size-4" aria-hidden />
              Prepare a new plan
            </Button>
          )}
        </Callout>
      )}
      {plan.status === 'confirmed' && (
        <Callout tone="success">
          <span className="font-medium">Confirmed</span>
          {plan.confirmedBy && ` by ${plan.confirmedBy.name}`}
          {plan.confirmedAt && `, ${formatDateTime(plan.confirmedAt)}`}. Purchase orders placed:{' '}
          {plan.groups
            .filter((g) => g.purchaseOrder)
            .map((g, i) => (
              <span key={g.purchaseOrder!.id}>
                {i > 0 && ', '}
                <Link
                  to={`/purchases/${g.purchaseOrder!.id}`}
                  className="font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                >
                  {g.purchaseOrder!.poNumber}
                </Link>
              </span>
            ))}
          .
        </Callout>
      )}
      {plan.status === 'cancelled' && (
        <Card className="p-4 text-sm">
          Cancelled{plan.cancelledAt && ` ${formatDateTime(plan.cancelledAt)}`}. Nothing was
          ordered.
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Summary
          label="Items"
          value={String(plan.itemCount)}
          detail={`from ${plan.supplierCount} ${plan.supplierCount === 1 ? 'supplier' : 'suppliers'}`}
        />
        <Summary label="Before GST" value={formatINR(plan.taxable)} />
        <Summary label="GST (input credit)" value={formatINR(plan.cgst + plan.sgst + plan.igst)} />
        <Summary
          label="Total"
          value={formatINR(plan.total)}
          detail={plan.budget !== undefined ? `Budget ${formatINR(plan.budget)}` : 'No budget set'}
        />
      </div>

      {plan.groups.map((group) => (
        <SupplierGroup
          key={group.supplier.id}
          group={group}
          editable={editable}
          edits={edits}
          removed={removed}
          onEdit={(productId, text) => setEdits((e) => ({ ...e, [productId]: text }))}
          onToggle={(productId) =>
            setRemoved((r) => {
              const next = new Set(r);
              if (next.has(productId)) next.delete(productId);
              else next.add(productId);
              return next;
            })
          }
        />
      ))}

      {plan.skipped.length > 0 && (
        <Card className="p-6">
          <h2 className="text-base font-semibold">Not in this plan</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {plan.skipped.map((s) => (
              <li key={s.product.id}>
                <Link
                  to={`/products/${s.product.id}`}
                  className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {s.product.name}
                </Link>
                <span className="text-slate-500 dark:text-slate-400">: {s.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={confirming}
        title="Confirm and place the orders?"
        confirmLabel={`Place ${plan.supplierCount} ${plan.supplierCount === 1 ? 'order' : 'orders'}`}
        confirmVariant="primary"
        loading={confirm.isPending}
        onConfirm={() => confirm.mutate()}
        onClose={() => setConfirming(false)}
      >
        This places {plan.supplierCount} purchase {plan.supplierCount === 1 ? 'order' : 'orders'},{' '}
        {formatINR(plan.total)} in all incl. GST, with {supplierNames.join(', ')}. Each is expected
        after that supplier&apos;s delivery time.
      </ConfirmDialog>
      <ConfirmDialog
        open={cancelling}
        title="Cancel this plan?"
        confirmLabel="Cancel plan"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => setCancelling(false)}
      >
        Nothing will be ordered. You can prepare a new plan at any time.
      </ConfirmDialog>
    </div>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
    </Card>
  );
}

function SupplierGroup({
  group,
  editable,
  edits,
  removed,
  onEdit,
  onToggle,
}: {
  group: RestockPlanGroupDto;
  editable: boolean;
  edits: Edits;
  removed: Set<string>;
  onEdit(productId: string, text: string): void;
  onToggle(productId: string): void;
}) {
  const days = group.supplier.leadTimeDays;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-4 sm:px-6 dark:border-slate-800">
        <div>
          <h2 className="text-base font-semibold">{group.supplier.name}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Delivers in {days} {days === 1 ? 'day' : 'days'} ·{' '}
            {group.interState ? 'IGST' : 'CGST + SGST'}
          </p>
        </div>
        <div className="text-right">
          {group.purchaseOrder && (
            <Link
              to={`/purchases/${group.purchaseOrder.id}`}
              className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300"
            >
              {group.purchaseOrder.poNumber}
            </Link>
          )}
          <p className="text-sm font-semibold tabular-nums">{formatINR(group.total)}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm md:table-fixed">
          <caption className="sr-only">Items to order from {group.supplier.name}</caption>
          <thead className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium sm:px-6">
                Product
              </th>
              <th
                scope="col"
                className="hidden w-28 px-3 py-2 text-right font-medium whitespace-nowrap md:table-cell"
              >
                In stock
              </th>
              <th
                scope="col"
                className="hidden w-24 px-3 py-2 text-right font-medium whitespace-nowrap md:table-cell"
              >
                Sells / day
              </th>
              <th
                scope="col"
                className="hidden w-28 px-3 py-2 text-right font-medium whitespace-nowrap sm:table-cell"
              >
                Suggested
              </th>
              <th scope="col" className="w-24 px-3 py-2 text-right font-medium sm:w-32">
                Order
              </th>
              <th
                scope="col"
                className="hidden w-32 px-3 py-2 text-right font-medium sm:table-cell"
              >
                Amount
              </th>
              {editable && (
                <th scope="col" className="w-12 px-3 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {group.items.map((item) => {
              const pid = item.product.id;
              const isRemoved = removed.has(pid);
              const text = edits[pid] ?? String(item.quantity);
              const parsed = parseQuantity(text, item.product.unit);
              const error = typeof parsed === 'string' ? parsed : undefined;
              return (
                <tr key={pid} className={isRemoved ? 'align-top opacity-50' : 'align-top'}>
                  <td className="px-4 py-3 sm:px-6">
                    <Link
                      to={`/restock/products/${pid}`}
                      className={`font-medium hover:text-indigo-600 dark:hover:text-indigo-400 ${isRemoved ? 'line-through' : ''}`}
                    >
                      {item.product.name}
                    </Link>
                    <p className="mt-0.5 max-w-md text-xs text-slate-600 dark:text-slate-300">
                      {item.reasons.join(' · ')}
                    </p>
                    {isRemoved && (
                      <p className="mt-0.5 text-xs font-medium text-slate-500">
                        Removed: save to keep this change
                      </p>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-right whitespace-nowrap tabular-nums md:table-cell">
                    {formatQuantity(item.stock, item.product.unit)}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {lastsLabel(item.daysUntilStockout, item.stock)}
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 text-right tabular-nums md:table-cell">
                    {formatRate(item.dailyDemand)}
                  </td>
                  <td className="hidden px-3 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {item.suggestedQuantity > 0
                      ? formatQuantity(item.suggestedQuantity, item.product.unit)
                      : '—'}
                    {item.packSize > 1 && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        packs of {item.packSize}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {editable && !isRemoved ? (
                      <div className="ml-auto w-20 sm:w-24">
                        <Input
                          aria-label={`Quantity of ${item.product.name}`}
                          inputMode="decimal"
                          className="text-right tabular-nums"
                          value={text}
                          invalid={!!error}
                          aria-describedby={error ? `qty-error-${pid}` : undefined}
                          onChange={(e) => onEdit(pid, e.target.value)}
                        />
                        {error && (
                          <p
                            id={`qty-error-${pid}`}
                            className="mt-1 text-xs text-rose-600 dark:text-rose-400"
                          >
                            {error}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="font-medium whitespace-nowrap tabular-nums">
                        {formatQuantity(item.quantity, item.product.unit)}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {formatINR(item.total)}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {formatINR(item.unitCost)} + {item.gstRate}%
                    </div>
                  </td>
                  {editable && (
                    <td className="px-3 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={
                          isRemoved ? `Keep ${item.product.name}` : `Remove ${item.product.name}`
                        }
                        onClick={() => onToggle(pid)}
                      >
                        {isRemoved ? (
                          <Undo2 className="size-4" aria-hidden />
                        ) : (
                          <Trash2 className="size-4" aria-hidden />
                        )}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
