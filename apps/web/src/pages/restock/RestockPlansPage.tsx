import {
  formatINR,
  RESTOCK_PLAN_STATUSES,
  type Paginated,
  type RestockPlanStatus,
  type RestockPlanSummaryDto,
} from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { PlanStatusBadge } from '@/components/RestockBadges';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useUrlFilters } from '@/lib/useUrlFilters';
import { PrepareRestockDialog } from './PrepareRestockDialog';
import { RESTOCK_TABS } from './tabs';

const STATUS_LABELS: Record<RestockPlanStatus, string> = {
  draft: 'Waiting for review',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export function RestockPlansPage() {
  const { can } = useAuth();
  const { params, update } = useUrlFilters();
  const [preparing, setPreparing] = useState(false);
  const query = new URLSearchParams();
  for (const key of ['status', 'page']) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const plans = useQuery({
    queryKey: ['restock-plans', query.toString()],
    queryFn: () => apiFetch<Paginated<RestockPlanSummaryDto>>(`/restock/plans?${query}`),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Smart Restock"
        description="Every restock plan, and the purchase orders the confirmed ones placed."
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
      <div className="w-56">
        <Select
          aria-label="Status"
          value={params.get('status') ?? ''}
          onChange={(e) => update({ status: e.target.value || null })}
        >
          <option value="">All plans</option>
          {RESTOCK_PLAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      {plans.isError && (
        <ErrorAlert>Could not load the plans. {(plans.error as Error).message}</ErrorAlert>
      )}
      <Card className="overflow-hidden">
        {plans.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading restock plans" />
          </div>
        ) : plans.data && plans.data.data.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            No restock plans yet. Prepare one from the forecasts.
          </p>
        ) : plans.data ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Restock plans</caption>
                <thead className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium sm:px-6">
                      Plan
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Status
                    </th>
                    <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                      Prepared
                    </th>
                    <th
                      scope="col"
                      className="hidden px-3 py-2 text-right font-medium sm:table-cell"
                    >
                      Items
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium sm:px-6">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {plans.data.data.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 sm:px-6">
                        <Link
                          to={`/restock/plans/${p.id}`}
                          className="font-medium whitespace-nowrap hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {p.planNumber}
                        </Link>
                        <div className="text-xs text-slate-500 md:hidden dark:text-slate-400">
                          {formatDateTime(p.createdAt)}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <PlanStatusBadge status={p.status} />
                      </td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        {formatDateTime(p.createdAt)}
                        {p.createdBy && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {p.source === 'assistant' ? 'AI assistant for ' : ''}
                            {p.createdBy.name}
                          </div>
                        )}
                      </td>
                      <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">
                        {p.itemCount}
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {p.supplierCount} {p.supplierCount === 1 ? 'supplier' : 'suppliers'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums sm:px-6">
                        {formatINR(p.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={plans.data.page}
              pageSize={plans.data.pageSize}
              total={plans.data.total}
              onPage={(page) => update({ page: page === 1 ? null : String(page) })}
            />
          </>
        ) : null}
      </Card>
      <PrepareRestockDialog open={preparing} onClose={() => setPreparing(false)} />
    </div>
  );
}
