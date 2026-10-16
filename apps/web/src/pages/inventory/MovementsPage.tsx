import {
  MOVEMENT_TYPE_LABELS,
  STOCK_MOVEMENT_TYPES,
  formatINR,
  type Paginated,
  type ProductDto,
  type StockMovementDto,
} from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { MovementBadge } from '@/components/MovementBadge';
import { ProductPicker } from '@/components/ProductPicker';
import { ErrorAlert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatChange, formatDateTime, formatQuantity } from '@/lib/format';
import { useUrlFilters } from '@/lib/useUrlFilters';
import { INVENTORY_TABS } from './tabs';

const KEYS = ['product', 'type', 'from', 'to', 'page'] as const;

export function MovementsPage() {
  const { can } = useAuth();
  const { params, update } = useUrlFilters();

  const query = new URLSearchParams();
  for (const key of KEYS) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const movements = useQuery({
    queryKey: ['movements', query.toString()],
    queryFn: () => apiFetch<Paginated<StockMovementDto>>(`/inventory/movements?${query}`),
    placeholderData: (previous) => previous,
  });
  const productId = params.get('product');
  const product = useQuery({
    queryKey: ['product', productId],
    queryFn: () => apiFetch<{ product: ProductDto }>(`/products/${productId}`),
    enabled: !!productId,
  });
  const showValue = movements.data?.data.some((m) => m.value !== undefined) ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Every change to stock, with who made it and why."
        tabs={INVENTORY_TABS.filter((t) => can(t.permission))}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div className="sm:col-span-2 lg:col-span-1">
          {productId ? (
            <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
              <span className="truncate">
                Product: <span className="font-medium">{product.data?.product.name ?? '…'}</span>
              </span>
              <button
                type="button"
                onClick={() => update({ product: null })}
                aria-label="Show all products"
                className="text-slate-500 hover:text-slate-700"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <ProductPicker
              includeInactive
              label="Filter by product"
              placeholder="Filter by product"
              onSelect={(p) => update({ product: p.id })}
            />
          )}
        </div>
        <Select
          aria-label="Type of change"
          value={params.get('type') ?? ''}
          onChange={(e) => update({ type: e.target.value })}
        >
          <option value="">All changes</option>
          {STOCK_MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Field label="From">
          <Input
            type="date"
            value={params.get('from') ?? ''}
            max={params.get('to') ?? undefined}
            onChange={(e) => update({ from: e.target.value })}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            value={params.get('to') ?? ''}
            min={params.get('from') ?? undefined}
            onChange={(e) => update({ to: e.target.value })}
          />
        </Field>
      </div>

      {movements.isError && (
        <ErrorAlert>Could not load stock history. {(movements.error as Error).message}</ErrorAlert>
      )}

      <Card className="overflow-hidden">
        {movements.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading stock history" />
          </div>
        ) : movements.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            No stock changes match these filters.
          </p>
        ) : (
          <>
            <div className={cn('overflow-x-auto', movements.isFetching && 'opacity-60')}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      When
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Product
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                      What
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Change
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-3 text-right font-medium sm:table-cell"
                    >
                      Stock after
                    </th>
                    {showValue && (
                      <th
                        scope="col"
                        className="hidden px-4 py-3 text-right font-medium lg:table-cell"
                      >
                        Value
                      </th>
                    )}
                    <th scope="col" className="hidden px-4 py-3 font-medium xl:table-cell">
                      By
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {movements.data!.data.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {formatDateTime(m.occurredAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/products/${m.product.id}`}
                          className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {m.product.name}
                        </Link>
                        <div className="mt-1 md:hidden">
                          <MovementBadge movement={m} />
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <MovementBadge movement={m} />
                        {(m.reference || m.note) && (
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {m.reference?.number}
                            {m.reference && m.note && ' · '}
                            {m.note}
                          </div>
                        )}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums',
                          m.quantity > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-slate-100',
                        )}
                      >
                        {formatChange(m.quantity, m.product.unit)}
                      </td>
                      <td className="hidden px-4 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                        {formatQuantity(m.balanceAfter, m.product.unit)}
                      </td>
                      {showValue && (
                        <td className="hidden px-4 py-3 text-right whitespace-nowrap tabular-nums lg:table-cell">
                          {m.value !== undefined ? formatINR(m.value) : '—'}
                        </td>
                      )}
                      <td className="hidden px-4 py-3 whitespace-nowrap text-slate-500 xl:table-cell dark:text-slate-400">
                        {m.createdBy?.name ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination
                page={movements.data!.page}
                pageSize={movements.data!.pageSize}
                total={movements.data!.total}
                onPage={(page) => update({ page: page > 1 ? String(page) : null })}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
