import { formatINR, type Paginated, type PurchaseOrderSummaryDto } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { PurchaseStatusBadge } from '@/components/PurchaseStatusBadge';
import { ErrorAlert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useSuppliers } from '@/lib/queries';
import { useUrlFilters } from '@/lib/useUrlFilters';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Awaiting delivery' },
  { value: 'draft', label: 'Drafts' },
  { value: 'received', label: 'Received' },
  { value: 'closed', label: 'Closed short' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

export function PurchasesPage() {
  const { can } = useAuth();
  const { params, update } = useUrlFilters();
  const suppliers = useSuppliers();
  const [search, setSearch] = useState(params.get('search') ?? '');

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === (params.get('search') ?? '')) return;
    const timer = setTimeout(() => update({ search: trimmed || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams();
  for (const key of ['status', 'supplier', 'search', 'page'] as const) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const orders = useQuery({
    queryKey: ['purchase-orders', query.toString()],
    queryFn: () => apiFetch<Paginated<PurchaseOrderSummaryDto>>(`/purchase-orders?${query}`),
    placeholderData: (previous) => previous,
  });
  const status = params.get('status') ?? '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        description="Orders to suppliers, and the goods received against them."
        actions={
          can('purchases:manage') && (
            <Link to="/purchases/new" className={buttonClass()}>
              <Plus className="size-4" aria-hidden />
              New purchase order
            </Link>
          )
        }
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Order status">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={status === f.value}
            onClick={() => update({ status: f.value || null })}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              status === f.value
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="PO number"
            aria-label="Search PO number"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Supplier"
          value={params.get('supplier') ?? ''}
          onChange={(e) => update({ supplier: e.target.value })}
        >
          <option value="">All suppliers</option>
          {suppliers.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      {orders.isError && (
        <ErrorAlert>Could not load purchase orders. {(orders.error as Error).message}</ErrorAlert>
      )}

      <Card className="overflow-hidden">
        {orders.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading purchase orders" />
          </div>
        ) : orders.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            No purchase orders match these filters.
          </p>
        ) : (
          <>
            <div className={cn('overflow-x-auto', orders.isFetching && 'opacity-60')}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Order
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                      Ordered
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                      Expected
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {orders.data!.data.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <Link
                          to={`/purchases/${o.id}`}
                          className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {o.poNumber}
                        </Link>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {o.supplier.name} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-slate-500 md:table-cell dark:text-slate-400">
                        {o.orderedAt ? formatDate(o.orderedAt) : '—'}
                      </td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-slate-500 sm:table-cell dark:text-slate-400">
                        {o.expectedAt ? formatDate(o.expectedAt) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <PurchaseStatusBadge status={o.status} overdue={o.overdue} />
                      </td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                        {formatINR(o.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination
                page={orders.data!.page}
                pageSize={orders.data!.pageSize}
                total={orders.data!.total}
                onPage={(page) => update({ page: page > 1 ? String(page) : null })}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
