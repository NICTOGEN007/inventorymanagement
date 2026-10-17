import {
  formatINR,
  type ForecastAccuracyDto,
  type ForecastItemDto,
  type ForecastOverviewDto,
  type RestockStatus,
} from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardList, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import {
  formatRate,
  lastsLabel,
  RESTOCK_STATUS_LABELS,
  RestockStatusBadge,
} from '@/components/RestockBadges';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateKey, formatQuantity } from '@/lib/format';
import { useRestockAlerts } from '@/lib/restock';
import { useUrlFilters } from '@/lib/useUrlFilters';
import { PrepareRestockDialog } from './PrepareRestockDialog';
import { RESTOCK_TABS } from './tabs';

const FILTERS: (RestockStatus | 'all')[] = ['all', 'reorder', 'watch', 'ordered', 'ok', 'dead'];

export function SmartRestockPage() {
  const { can } = useAuth();
  const { params, update } = useUrlFilters();
  const [preparing, setPreparing] = useState(false);
  const filter = (FILTERS.find((f) => f === params.get('status')) ?? 'all') as
    RestockStatus | 'all';

  const overview = useQuery({
    queryKey: ['forecast'],
    queryFn: () => apiFetch<{ overview: ForecastOverviewDto }>('/forecast'),
    select: (r) => r.overview,
  });
  const accuracy = useQuery({
    queryKey: ['forecast', 'accuracy'],
    queryFn: () => apiFetch<{ accuracy: ForecastAccuracyDto | null }>('/forecast/accuracy'),
    select: (r) => r.accuracy,
    staleTime: 10 * 60_000,
  });
  const alerts = useRestockAlerts();

  const o = overview.data;
  const items = o?.items.filter((i) => filter === 'all' || i.status === filter) ?? [];
  const openPlan = alerts.data?.openPlan;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Smart Restock"
        description="Demand forecasts from past sales, and restock plans you review and confirm."
        tabs={RESTOCK_TABS}
        actions={
          can('purchases:manage') && (
            <Button onClick={() => setPreparing(true)}>
              <Sparkles className="size-4" aria-hidden />
              Prepare restock plan
            </Button>
          )
        }
      />

      {openPlan && (
        <Callout tone="info" className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm">
            <ClipboardList
              className="size-4 shrink-0 text-indigo-600 dark:text-indigo-400"
              aria-hidden
            />
            <span>
              <span className="font-medium">{openPlan.planNumber}</span> is waiting for review:{' '}
              {openPlan.itemCount} {openPlan.itemCount === 1 ? 'item' : 'items'}.
            </span>
          </p>
          <Link to={`/restock/plans/${openPlan.id}`} className={buttonClass({ size: 'sm' })}>
            Review plan <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Callout>
      )}

      {overview.isError && (
        <ErrorAlert>Could not load the forecasts. {(overview.error as Error).message}</ErrorAlert>
      )}
      {overview.isPending ? (
        <div className="flex justify-center p-16">
          <Spinner label="Working out the forecasts" />
        </div>
      ) : o ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Reorder now"
              value={o.counts.reorder}
              detail={
                alerts.data
                  ? `${alerts.data.outOfStock} out of stock, ${alerts.data.runningOut} run out before a delivery`
                  : 'Stock will not last until a delivery'
              }
            />
            <StatTile
              label="Order soon"
              value={o.counts.watch}
              detail="Will need an order within 3 days"
            />
            <StatTile
              label="Not selling"
              value={o.counts.dead}
              detail="No sale in 60 days, so never reordered"
            />
            <StatTile
              label="Forecast error"
              value={accuracy.data ? `${accuracy.data.wape}%` : '—'}
              detail={
                accuracy.data
                  ? `Weekly, last 4 weeks. A moving average: ${accuracy.data.baseline.wape}%`
                  : accuracy.isPending
                    ? 'Checking against recent weeks…'
                    : 'Needs more sales history'
              }
            />
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
                {FILTERS.map((f) => {
                  const count = f === 'all' ? o.items.length : o.counts[f];
                  return (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={filter === f}
                      onClick={() => update({ status: f === 'all' ? null : f })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm',
                        filter === f
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                      )}
                    >
                      {f === 'all' ? 'All' : RESTOCK_STATUS_LABELS[f]}{' '}
                      <span className="tabular-nums opacity-80">{count}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Based on sales up to {formatDateKey(o.asOf, 'medium')}
              </p>
            </div>
            <ForecastTable items={items} />
          </Card>
        </>
      ) : null}

      <PrepareRestockDialog open={preparing} onClose={() => setPreparing(false)} />
    </div>
  );
}

function ForecastTable({ items }: { items: ForecastItemDto[] }) {
  if (items.length === 0) {
    return <p className="px-6 py-10 text-center text-sm text-slate-500">No products here.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Demand forecast and restock advice for each product</caption>
        <thead className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium sm:px-6">
              Product
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
              Status
            </th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
              In stock
            </th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">
              Sells / day
            </th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">
              Lasts
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Suggested
            </th>
            <th scope="col" className="hidden px-6 py-2 font-medium lg:table-cell">
              Why
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((i) => (
            <tr key={i.product.id} className="align-top">
              <td className="px-4 py-3 sm:px-6">
                <Link
                  to={`/restock/products/${i.product.id}`}
                  className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {i.product.name}
                </Link>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {i.supplier ? i.supplier.name : 'No supplier set'}
                </div>
                <div className="mt-1 sm:hidden">
                  <RestockStatusBadge status={i.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600 sm:line-clamp-none lg:hidden dark:text-slate-300">
                  {i.reasons.join(' · ')}
                </p>
              </td>
              <td className="hidden px-3 py-3 sm:table-cell">
                <RestockStatusBadge status={i.status} />
              </td>
              <td className="hidden px-3 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                {formatQuantity(i.stock, i.product.unit)}
                {i.onOrder > 0 && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    +{formatQuantity(i.onOrder, i.product.unit)} on order
                  </div>
                )}
              </td>
              <td className="hidden px-3 py-3 text-right tabular-nums md:table-cell">
                {formatRate(i.dailyDemand)}
              </td>
              <td className="hidden px-3 py-3 text-right whitespace-nowrap md:table-cell">
                {lastsLabel(i.daysUntilStockout, i.stock)}
              </td>
              <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                {i.suggestedQuantity > 0 ? (
                  <>
                    <span className="font-medium">
                      {formatQuantity(i.suggestedQuantity, i.product.unit)}
                    </span>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {formatINR(Math.round(i.suggestedQuantity * i.unitCost))} + GST
                    </div>
                  </>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="hidden max-w-sm px-6 py-3 text-xs text-slate-600 lg:table-cell dark:text-slate-300">
                {i.reasons.join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
