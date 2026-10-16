import { formatINR, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type SaleList } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ErrorAlert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, istDateInput } from '@/lib/format';
import { useUrlFilters } from '@/lib/useUrlFilters';
import { POS_TABS } from './tabs';

function ranges() {
  const today = istDateInput(0);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: istDateInput(-1), to: istDateInput(-1) },
    { label: 'Last 7 days', from: istDateInput(-6), to: today },
    { label: 'This month', from: `${today.slice(0, 8)}01`, to: today },
    { label: 'All', from: '', to: '' },
  ];
}

export function SalesPage() {
  const { params, update } = useUrlFilters();
  const [search, setSearch] = useState(params.get('search') ?? '');

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === (params.get('search') ?? '')) return;
    const timer = setTimeout(() => update({ search: trimmed || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams();
  for (const key of ['from', 'to', 'search', 'method', 'page'] as const) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const sales = useQuery({
    queryKey: ['sales', query.toString()],
    queryFn: () => apiFetch<SaleList>(`/sales?${query}`),
    placeholderData: (previous) => previous,
  });
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const summary = sales.data?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Point of Sale"
        description="Every bill issued, with its GST invoice."
        tabs={POS_TABS}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
        {ranges().map((r) => {
          const selected = r.from === from && r.to === to;
          return (
            <button
              key={r.label}
              type="button"
              aria-pressed={selected}
              onClick={() => update({ from: r.from || null, to: r.to || null })}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                selected
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Invoice, customer or phone"
            aria-label="Search sales"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Payment method"
          value={params.get('method') ?? ''}
          onChange={(e) => update({ method: e.target.value })}
        >
          <option value="">Any payment</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          aria-label="From"
          value={from}
          onChange={(e) => update({ from: e.target.value })}
        />
        <Input
          type="date"
          aria-label="To"
          value={to}
          onChange={(e) => update({ to: e.target.value })}
        />
      </div>

      {summary && (
        <div className="grid gap-4 sm:max-w-md">
          <StatTile
            label="Sales"
            value={formatINR(summary.total)}
            detail={`${summary.count.toLocaleString('en-IN')} ${summary.count === 1 ? 'bill' : 'bills'}${
              summary.count > 0
                ? ` · average ${formatINR(Math.round(summary.total / summary.count))}`
                : ''
            }`}
          />
        </div>
      )}

      {sales.isError && (
        <ErrorAlert>Could not load sales. {(sales.error as Error).message}</ErrorAlert>
      )}

      <Card className="overflow-hidden">
        {sales.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading sales" />
          </div>
        ) : sales.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No sales match these filters.</p>
        ) : (
          <>
            <div className={cn('overflow-x-auto', sales.isFetching && 'opacity-60')}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Invoice
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                      Date
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                      Paid by
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sales.data!.data.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <Link
                          to={`/pos/sales/${s.id}`}
                          className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {s.invoiceNumber}
                        </Link>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {s.customer?.name ?? 'Walk-in customer'} · {s.itemCount}{' '}
                          {s.itemCount === 1 ? 'item' : 'items'}
                          <span className="md:hidden"> · {formatDateTime(s.soldAt)}</span>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-slate-500 md:table-cell dark:text-slate-400">
                        {formatDateTime(s.soldAt)}
                        <div className="text-xs">{s.cashier.name}</div>
                      </td>
                      <td className="hidden px-4 py-3 text-slate-600 sm:table-cell dark:text-slate-300">
                        {s.paymentMethods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' + ')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                        {formatINR(s.grandTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination
                page={sales.data!.page}
                pageSize={sales.data!.pageSize}
                total={sales.data!.total}
                onPage={(page) => update({ page: page > 1 ? String(page) : null })}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
