import { formatINR, getStateName, type CustomerListItemDto, type Paginated } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { CustomerFormDialog } from '@/components/CustomerFormDialog';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useUrlFilters } from '@/lib/useUrlFilters';

export function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { params, update } = useUrlFilters();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === (params.get('search') ?? '')) return;
    const timer = setTimeout(() => update({ search: trimmed || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams();
  for (const key of ['search', 'status', 'page'] as const) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const customers = useQuery({
    queryKey: ['customers', 'list', query.toString()],
    queryFn: () => apiFetch<Paginated<CustomerListItemDto>>(`/customers?${query}`),
    placeholderData: (previous) => previous,
  });
  const filtered = Boolean(params.get('search') || params.get('status'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Who buys from you, their GSTIN for business invoices, and what they spend."
        actions={
          can('customers:write') && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              Add customer
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_12rem]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Name, phone or GSTIN"
            aria-label="Search customers"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Status"
          value={params.get('status') ?? 'active'}
          onChange={(e) => update({ status: e.target.value === 'active' ? null : e.target.value })}
        >
          <option value="active">Active customers</option>
          <option value="inactive">Inactive</option>
          <option value="all">All customers</option>
        </Select>
      </div>

      {customers.isError && (
        <ErrorAlert>Could not load customers. {(customers.error as Error).message}</ErrorAlert>
      )}

      <Card className="overflow-hidden">
        {customers.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading customers" />
          </div>
        ) : customers.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            {filtered ? 'No customers match these filters.' : 'No customers yet.'}
          </p>
        ) : (
          <>
            <div className={cn('overflow-x-auto', customers.isFetching && 'opacity-60')}>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Customer
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                      GSTIN
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-3 text-right font-medium sm:table-cell"
                    >
                      Bills
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Spent
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">
                      Last visit
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {customers.data!.data.map((c) => (
                    <tr
                      key={c.id}
                      className={cn(
                        'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                        !c.isActive && 'opacity-60',
                      )}
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/customers/${c.id}`}
                          className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {c.name}
                        </Link>{' '}
                        {!c.isActive && <Badge>Inactive</Badge>}
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {c.phone ?? 'No phone'}
                          <span className="sm:hidden">
                            {' '}
                            · {c.stats.visits} {c.stats.visits === 1 ? 'bill' : 'bills'}
                          </span>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {c.gstin ? (
                          <span className="font-mono text-xs">{c.gstin}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {c.stateCode && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {getStateName(c.stateCode)}
                          </div>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                        {c.stats.visits.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                        {formatINR(c.stats.totalSpent)}
                      </td>
                      <td className="hidden px-4 py-3 whitespace-nowrap text-slate-500 lg:table-cell dark:text-slate-400">
                        {c.stats.lastPurchaseAt ? formatDate(c.stats.lastPurchaseAt) : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination
                page={customers.data!.page}
                pageSize={customers.data!.pageSize}
                total={customers.data!.total}
                onPage={(page) => update({ page: page > 1 ? String(page) : null })}
              />
            </div>
          </>
        )}
      </Card>

      <CustomerFormDialog
        customer={null}
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(c) => navigate(`/customers/${c.id}`)}
      />
    </div>
  );
}
