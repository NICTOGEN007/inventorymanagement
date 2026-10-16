import { formatINR, PAYMENT_METHOD_LABELS, type SaleReturnList } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { Search, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useUrlFilters } from '@/lib/useUrlFilters';
import { FindInvoiceDialog } from './FindInvoiceDialog';
import { PeriodChips } from './PeriodChips';
import { POS_TABS } from './tabs';

export function ReturnsPage() {
  const { can } = useAuth();
  const { params, update } = useUrlFilters();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === (params.get('search') ?? '')) return;
    const timer = setTimeout(() => update({ search: trimmed || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams();
  for (const key of ['from', 'to', 'search', 'page'] as const) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const returns = useQuery({
    queryKey: ['returns', query.toString()],
    queryFn: () => apiFetch<SaleReturnList>(`/returns?${query}`),
    placeholderData: (previous) => previous,
  });
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const summary = returns.data?.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Point of Sale"
        description="Goods taken back, with the credit note issued for each refund."
        tabs={POS_TABS}
        actions={
          can('returns:create') && (
            <Button onClick={() => setFinding(true)}>
              <Undo2 className="size-4" aria-hidden />
              New return
            </Button>
          )
        }
      />

      <PeriodChips from={from} to={to} onChange={update} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Return, invoice or customer"
            aria-label="Search returns"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
            label="Refunds"
            value={formatINR(summary.total)}
            detail={`${summary.count.toLocaleString('en-IN')} ${summary.count === 1 ? 'return' : 'returns'}`}
          />
        </div>
      )}

      {returns.isError && (
        <ErrorAlert>Could not load returns. {(returns.error as Error).message}</ErrorAlert>
      )}

      <Card className="overflow-hidden">
        {returns.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading returns" />
          </div>
        ) : returns.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No returns match these filters.</p>
        ) : (
          <>
            <div className={cn('overflow-x-auto', returns.isFetching && 'opacity-60')}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Credit note
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                      Date
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">
                      Reason
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Refund
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {returns.data!.data.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <Link
                          to={`/pos/returns/${r.id}`}
                          className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {r.returnNumber}
                        </Link>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {r.sale.invoiceNumber} · {r.customer?.name ?? 'Walk-in customer'}
                          <span className="md:hidden"> · {formatDateTime(r.returnedAt)}</span>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-slate-500 md:table-cell dark:text-slate-400">
                        {formatDateTime(r.returnedAt)}
                        <div className="text-xs">{r.processedBy.name}</div>
                      </td>
                      <td className="hidden max-w-56 truncate px-4 py-3 text-slate-600 lg:table-cell dark:text-slate-300">
                        {r.reason}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="font-medium tabular-nums">{formatINR(r.totalRefund)}</span>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {PAYMENT_METHOD_LABELS[r.refundMethod]}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination
                page={returns.data!.page}
                pageSize={returns.data!.pageSize}
                total={returns.data!.total}
                onPage={(page) => update({ page: page > 1 ? String(page) : null })}
              />
            </div>
          </>
        )}
      </Card>

      <FindInvoiceDialog open={finding} onClose={() => setFinding(false)} />
    </div>
  );
}
