import {
  ADJUSTMENT_REASON_LABELS,
  formatINR,
  formatINRCompact,
  type InventorySummary,
  type Paginated,
  type ProductDto,
} from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, PackageX } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { StockBadge } from '@/components/StockBadge';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { formatQuantity } from '@/lib/format';
import { INVENTORY_TABS } from './tabs';

export function InventoryPage() {
  const { can } = useAuth();
  const tabs = INVENTORY_TABS.filter((t) => can(t.permission));
  const summary = useQuery({
    queryKey: ['inventory', 'summary'],
    queryFn: () => apiFetch<InventorySummary>('/inventory/summary'),
    enabled: can('reports:read'),
  });
  const attention = useQuery({
    queryKey: ['inventory', 'attention'],
    queryFn: async () => {
      const [out, low] = await Promise.all([
        apiFetch<Paginated<ProductDto>>('/products?stock=out&pageSize=50'),
        apiFetch<Paginated<ProductDto>>('/products?stock=low&sort=stock&pageSize=50'),
      ]);
      return [...out.data, ...low.data];
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="What is on the shelves, what it is worth, and what needs restocking."
        tabs={tabs}
        actions={
          can('inventory:adjust') && (
            <Link to="/inventory/adjust" className={buttonClass({ variant: 'secondary' })}>
              Adjust stock
            </Link>
          )
        }
      />

      {can('reports:read') && (
        <>
          {summary.isError && <ErrorAlert>Could not load stock value.</ErrorAlert>}
          {summary.data && <ValueSection summary={summary.data} />}
          {summary.isPending && (
            <div className="flex justify-center p-6">
              <Spinner label="Loading stock value" />
            </div>
          )}
        </>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-base font-semibold">Needs attention</h2>
          <Link
            to="/products?stock=low"
            className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          >
            All low-stock products
          </Link>
        </div>
        {attention.isPending ? (
          <div className="flex justify-center p-8">
            <Spinner label="Loading" />
          </div>
        ) : attention.data?.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            Everything is above its reorder level.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {attention.data?.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <Link
                    to={`/products/${p.id}`}
                    className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {p.name}
                  </Link>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {formatQuantity(p.stock, p.unit)} left · reorder at{' '}
                    {formatQuantity(p.reorderLevel, p.unit)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <StockBadge status={p.stockStatus} />
                  {p.onOrder > 0 ? (
                    <Badge tone="indigo">{formatQuantity(p.onOrder, p.unit)} on order</Badge>
                  ) : (
                    <Badge>Not ordered</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ValueSection({ summary }: { summary: InventorySummary }) {
  const maxValue = Math.max(1, ...summary.byCategory.map((c) => c.costValue));
  const potentialMargin = summary.retailValue - summary.costValue;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Stock value at cost"
          value={
            <span title={formatINR(summary.costValue)}>{formatINRCompact(summary.costValue)}</span>
          }
          detail={`${summary.products} active products`}
        />
        <StatTile
          label="Value at selling price"
          value={
            <span title={formatINR(summary.retailValue)}>
              {formatINRCompact(summary.retailValue)}
            </span>
          }
          detail={`${formatINRCompact(potentialMargin)} more than cost`}
        />
        <StatTile
          label="Low or out of stock"
          value={summary.lowStock + summary.outOfStock}
          detail={
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="size-3.5 text-amber-500" aria-hidden /> {summary.lowStock}{' '}
                low
              </span>
              <span className="inline-flex items-center gap-1">
                <PackageX className="size-3.5 text-rose-500" aria-hidden /> {summary.outOfStock} out
              </span>
            </span>
          }
        />
        <StatTile
          label="Written off, last 30 days"
          value={
            <span title={formatINR(summary.writeOffs30d.value)}>
              {formatINRCompact(summary.writeOffs30d.value)}
            </span>
          }
          detail={
            summary.writeOffs30d.byReason.length > 0
              ? summary.writeOffs30d.byReason
                  .map((r) => `${ADJUSTMENT_REASON_LABELS[r.reason]} ${formatINRCompact(r.value)}`)
                  .join(' · ')
              : 'No damage, expiry or loss'
          }
        />
      </div>

      <Card className="overflow-hidden">
        <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold dark:border-slate-800">
          Stock value by category
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Category
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  At cost
                </th>
                <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                  At selling price
                </th>
                <th scope="col" className="hidden px-4 py-2 text-right font-medium md:table-cell">
                  Low / out
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {summary.byCategory.map((row) => (
                <tr key={row.category.id}>
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/products?category=${row.category.id}`}
                      className="hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {row.category.name}
                    </Link>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {row.products} products
                    </div>
                  </td>
                  <td className="w-1/2 px-4 py-2.5">
                    <div
                      className="flex items-center gap-3"
                      title={`${row.category.name}: ${formatINR(row.costValue)} at cost`}
                    >
                      {/* One series, magnitude only: a single hue, rounded data end, value labelled in text ink. */}
                      <div className="h-2 flex-1 rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-2 rounded-full bg-indigo-500 dark:bg-indigo-400"
                          style={{ width: `${Math.max(2, (row.costValue / maxValue) * 100)}%` }}
                        />
                      </div>
                      <span className="w-20 text-right tabular-nums">
                        {formatINRCompact(row.costValue)}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-4 py-2.5 text-right tabular-nums sm:table-cell">
                    {formatINRCompact(row.retailValue)}
                  </td>
                  <td className="hidden px-4 py-2.5 text-right tabular-nums md:table-cell">
                    {row.lowStock} / {row.outOfStock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
