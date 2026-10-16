import {
  daysInPeriod,
  formatINR,
  PAYMENT_METHOD_LABELS,
  percentChange,
  presetPeriod,
  type DashboardDto,
  type PaymentMethod,
} from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, PackageOpen } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { BarList } from '@/components/charts/BarList';
import { ShareBar } from '@/components/charts/ShareBar';
import { TrendChart } from '@/components/charts/TrendChart';
import { StockBadge } from '@/components/StockBadge';
import { ErrorAlert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch, type HealthResponse } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatAxisINR, formatDateKey, formatQuantity } from '@/lib/format';
import { useUrlFilters } from '@/lib/useUrlFilters';

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];

/** Each payment method keeps its own colour whatever the order or the period. */
const METHOD_COLORS: Record<PaymentMethod, string> = {
  upi: 'var(--chart-1)',
  cash: 'var(--chart-2)',
  card: 'var(--chart-3)',
};

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage() {
  const { user } = useAuth();
  const { params, update } = useUrlFilters();
  const periodId = (PERIODS.find((p) => p.id === params.get('period'))?.id ?? 'last30') as PeriodId;
  const period = presetPeriod(periodId);
  const dashboard = useQuery({
    queryKey: ['dashboard', period.from, period.to],
    queryFn: () =>
      apiFetch<{ dashboard: DashboardDto }>(`/reports/dashboard?${new URLSearchParams(period)}`),
    select: (r) => r.dashboard,
    placeholderData: (previous) => previous,
  });
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    retry: false,
  });

  const d = dashboard.data;
  const days = daysInPeriod(period.from, period.to);
  const against = days === 1 ? 'yesterday' : `previous ${days} days`;
  const change = (now: number, before: number, upIsGood = true) => ({
    percent: percentChange(now, before),
    against,
    upIsGood,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {greeting(new Date().getHours())}, {user?.name.split(' ')[0]}. Here is how the shop is
            doing.
          </p>
        </div>
        <Link
          to="/reports"
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Detailed reports <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={p.id === periodId}
            onClick={() => update({ period: p.id === 'last30' ? null : p.id })}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              p.id === periodId
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {dashboard.isError && (
        <ErrorAlert>Could not load the dashboard. {(dashboard.error as Error).message}</ErrorAlert>
      )}
      {dashboard.isPending ? (
        <div className="flex justify-center p-16">
          <Spinner label="Loading the dashboard" />
        </div>
      ) : d ? (
        <div className={cn('space-y-6', dashboard.isFetching && 'opacity-60 transition-opacity')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Net sales"
              value={formatINR(d.totals.netSales)}
              change={change(d.totals.netSales, d.previousTotals.netSales)}
              detail={
                d.totals.refunds > 0
                  ? `after ${formatINR(d.totals.refunds)} refunded on ${d.totals.returns} ${d.totals.returns === 1 ? 'return' : 'returns'}`
                  : 'incl. GST, no refunds'
              }
            />
            <StatTile
              label="Gross profit"
              value={formatINR(d.totals.grossProfit)}
              change={change(d.totals.grossProfit, d.previousTotals.grossProfit)}
              detail={
                d.totals.margin !== null ? `${d.totals.margin}% margin on taxable value` : '—'
              }
            />
            <StatTile
              label="Bills"
              value={d.totals.bills.toLocaleString('en-IN')}
              change={change(d.totals.bills, d.previousTotals.bills)}
              detail={`${(d.totals.bills / days).toLocaleString('en-IN', { maximumFractionDigits: 1 })} a day`}
            />
            <StatTile
              label="Average bill"
              value={formatINR(d.totals.averageBill)}
              change={change(d.totals.averageBill, d.previousTotals.averageBill)}
              detail={`GST collected ${formatINR(d.totals.netTax)}`}
            />
          </div>

          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Net sales by day</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatDateKey(d.period.from, 'medium')} – {formatDateKey(d.period.to, 'medium')}
              </p>
            </div>
            <TrendChart
              label="Net sales"
              formatValue={formatINR}
              formatTick={formatAxisINR}
              points={d.daily.map((p) => ({
                key: p.date,
                label: formatDateKey(p.date, 'short'),
                title: formatDateKey(p.date),
                value: p.netSales,
                details: [
                  { label: 'bills', value: p.bills.toLocaleString('en-IN') },
                  { label: 'gross profit', value: formatINR(p.grossProfit) },
                ],
              }))}
            />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold">Top products</h2>
              {d.topProducts.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No sales in this period.
                </p>
              ) : (
                <BarList
                  label="Top products by net sales"
                  items={d.topProducts.map((p) => ({
                    key: p.product.id,
                    label: p.product.name,
                    to: `/products/${p.product.id}`,
                    detail: formatQuantity(p.quantity, p.product.unit),
                    value: p.sales,
                    display: formatINR(p.sales),
                  }))}
                />
              )}
            </Card>
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold">How customers paid</h2>
              {d.payments.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No sales in this period.
                </p>
              ) : (
                <ShareBar
                  label="Share of sales by payment method"
                  segments={(['upi', 'cash', 'card'] as const).map((m) => {
                    const p = d.payments.find((x) => x.method === m);
                    return {
                      key: m,
                      label: `${PAYMENT_METHOD_LABELS[m]}${p ? ` · ${p.bills} ${p.bills === 1 ? 'bill' : 'bills'}` : ''}`,
                      value: p?.amount ?? 0,
                      color: METHOD_COLORS[m],
                      display: formatINR(p?.amount ?? 0),
                    };
                  })}
                />
              )}
            </Card>
          </div>

          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Needs restocking</h2>
              <Link
                to="/inventory"
                className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Stock worth {formatINR(d.stock.costValue)} at cost · {d.stock.lowStock} low ·{' '}
                {d.stock.outOfStock} out
              </Link>
            </div>
            {d.stock.needsRestock.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <PackageOpen className="size-4" aria-hidden /> Everything is above its reorder
                level.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {d.stock.needsRestock.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Link
                        to={`/products/${p.id}`}
                        className="truncate font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {p.name}
                      </Link>
                      <StockBadge status={p.stock <= 0 ? 'out' : 'low'} />
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      {formatQuantity(p.stock, p.unit)} left · reorder at{' '}
                      {formatQuantity(p.reorderLevel, p.unit)}
                      {p.onOrder > 0
                        ? ` · ${formatQuantity(p.onOrder, p.unit)} on order`
                        : ' · not ordered'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      <p
        className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400"
        role="status"
      >
        <span
          className={cn(
            'size-2 rounded-full',
            health.isPending
              ? 'bg-slate-400'
              : health.data?.status === 'ok'
                ? 'bg-emerald-500'
                : 'bg-rose-500',
          )}
          aria-hidden
        />
        {health.isPending
          ? 'Checking the server…'
          : health.data?.status === 'ok'
            ? 'Server and database online'
            : 'Server or database unreachable'}
      </p>
    </div>
  );
}
