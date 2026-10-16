import {
  formatINR,
  getStateName,
  type CustomerDto,
  type SaleList,
  type SaleReturnList,
} from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { CustomerFormDialog } from '@/components/CustomerFormDialog';
import { SaleStatusBadge } from '@/components/SaleStatusBadge';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { StatTile } from '@/components/ui/StatTile';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatQuantity } from '@/lib/format';
import { useSettings } from '@/lib/queries';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['customers', 'detail', id],
    queryFn: () => apiFetch<{ customer: CustomerDto }>(`/customers/${id}`),
    select: (r) => r.customer,
  });
  const sales = useQuery({
    queryKey: ['sales', `customer=${id}&page=${page}`],
    queryFn: () =>
      apiFetch<SaleList>(
        `/sales?${new URLSearchParams({ customer: id, page: String(page), pageSize: '10' })}`,
      ),
    placeholderData: (previous) => previous,
  });
  const returns = useQuery({
    queryKey: ['returns', `customer=${id}`],
    queryFn: () =>
      apiFetch<SaleReturnList>(`/returns?${new URLSearchParams({ customer: id, pageSize: '5' })}`),
    enabled: (query.data?.stats.returns ?? 0) > 0,
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/customers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
      navigate('/customers', { replace: true });
    },
  });

  if (query.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading customer" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorAlert>Could not load this customer. {(query.error as Error).message}</ErrorAlert>;
  }
  const c = query.data;
  const { stats } = c;
  const shopState = settings.data?.stateCode;
  const otherState = !!c.stateCode && !!shopState && c.stateCode !== shopState;
  const address = [c.address?.line1, c.address?.line2, c.address?.city, c.address?.pincode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-6">
      <Link
        to="/customers"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="size-4" aria-hidden /> Customers
      </Link>
      <PageHeader
        title={c.name}
        description={
          <>
            {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}{' '}
            {!c.isActive && <Badge>Inactive</Badge>}
          </>
        }
        actions={
          can('customers:write') && (
            <>
              {stats.visits === 0 && (
                <Button variant="secondary" onClick={() => setDeleting(true)}>
                  <Trash2 className="size-4" aria-hidden />
                  Delete
                </Button>
              )}
              <Button onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total spent"
          value={formatINR(stats.totalSpent)}
          detail={
            stats.refunded > 0 ? `after ${formatINR(stats.refunded)} refunded` : 'net of returns'
          }
        />
        <StatTile
          label="Bills"
          value={stats.visits.toLocaleString('en-IN')}
          detail={stats.visits > 0 ? `average ${formatINR(stats.averageBill)}` : 'No bills yet'}
        />
        <StatTile
          label="Last visit"
          value={stats.lastPurchaseAt ? formatDate(stats.lastPurchaseAt) : '—'}
          detail={stats.firstPurchaseAt && `first bill ${formatDate(stats.firstPurchaseAt)}`}
        />
        <StatTile
          label="Returns"
          value={stats.returns.toLocaleString('en-IN')}
          detail={stats.returns > 0 ? `${formatINR(stats.refunded)} refunded` : 'None'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Details</h2>
          <dl className="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500 dark:text-slate-400">GSTIN</dt>
            <dd className={c.gstin ? 'font-mono text-xs leading-5' : 'text-slate-500'}>
              {c.gstin ?? 'Not registered (B2C)'}
            </dd>
            <dt className="text-slate-500 dark:text-slate-400">Place of supply</dt>
            <dd>
              {c.stateCode ? getStateName(c.stateCode) : 'Same state as the shop'}
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {otherState ? 'Other state: bills carry IGST' : 'Bills carry CGST + SGST'}
              </span>
            </dd>
            <dt className="text-slate-500 dark:text-slate-400">Address</dt>
            <dd className={address ? '' : 'text-slate-500'}>{address || 'Not given'}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Customer since</dt>
            <dd>{formatDate(c.createdAt)}</dd>
          </dl>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Buys most</h2>
          {c.topProducts.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Nothing bought yet.</p>
          ) : (
            <ol className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {c.topProducts.map((t) => (
                <li key={t.product.id} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="min-w-0">
                    <Link
                      to={`/products/${t.product.id}`}
                      className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {t.product.name}
                    </Link>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {formatQuantity(t.quantity, t.product.unit)}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatINR(t.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <section className="space-y-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-semibold">
          Purchase history
        </h2>
        <Card className="overflow-hidden">
          {sales.isPending ? (
            <div className="flex justify-center p-8">
              <Spinner label="Loading bills" />
            </div>
          ) : sales.isError ? (
            <div className="p-4">
              <ErrorAlert>Could not load bills.</ErrorAlert>
            </div>
          ) : sales.data.data.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No bills yet.</p>
          ) : (
            <>
              <div className={cn('overflow-x-auto', sales.isFetching && 'opacity-60')}>
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Bills</caption>
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Invoice
                      </th>
                      <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">
                        Date
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {sales.data.data.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-3">
                          <Link
                            to={`/pos/sales/${s.id}`}
                            className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                          >
                            {s.invoiceNumber}
                          </Link>{' '}
                          <SaleStatusBadge status={s.status} />
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {s.itemCount} {s.itemCount === 1 ? 'item' : 'items'}
                            <span className="sm:hidden"> · {formatDateTime(s.soldAt)}</span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 whitespace-nowrap text-slate-500 sm:table-cell dark:text-slate-400">
                          {formatDateTime(s.soldAt)}
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
                  page={sales.data.page}
                  pageSize={sales.data.pageSize}
                  total={sales.data.total}
                  onPage={setPage}
                />
              </div>
            </>
          )}
        </Card>
      </section>

      {stats.returns > 0 && (
        <section className="space-y-3" aria-labelledby="returns-heading">
          <h2 id="returns-heading" className="text-lg font-semibold">
            Returns
          </h2>
          <Card>
            {returns.isPending ? (
              <div className="flex justify-center p-6">
                <Spinner label="Loading returns" />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {returns.data?.data.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <span className="min-w-0">
                      <Link
                        to={`/pos/returns/${r.id}`}
                        className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        {r.returnNumber}
                      </Link>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {formatDate(r.returnedAt)} · {r.reason}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatINR(r.totalRefund)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <CustomerFormDialog customer={c} open={editing} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={deleting}
        title="Delete customer?"
        confirmLabel="Delete"
        loading={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        onConfirm={() => remove.mutate()}
        onClose={() => {
          setDeleting(false);
          remove.reset();
        }}
      >
        “{c.name}” has no bills and will be removed permanently.
      </ConfirmDialog>
    </div>
  );
}
