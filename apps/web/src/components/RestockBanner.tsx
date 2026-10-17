import { ArrowRight, PackageSearch, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ApiError } from '@/lib/api';
import { usePrepareRestockPlan, useRestockAlerts } from '@/lib/restock';
import { Button, buttonClass } from './ui/Button';
import { Callout } from './ui/Callout';

/**
 * Tells the owner when products need restocking, with the most urgent named, and opens the
 * waiting plan or prepares one. Nothing is ordered until they confirm the plan.
 */
export function RestockBanner() {
  const { can } = useAuth();
  const alerts = useRestockAlerts(can('forecast:read'));
  const prepare = usePrepareRestockPlan();
  const a = alerts.data;
  if (!a || a.reorder === 0) return null;

  const names = a.items.slice(0, 3).map((i) => i.name);
  const more = a.reorder - names.length;
  return (
    <Callout tone="warning" className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-start gap-3">
        <PackageSearch
          className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden
        />
        <div className="text-sm">
          <p className="font-medium">
            {a.reorder} {a.reorder === 1 ? 'product needs' : 'products need'} restocking
            {a.outOfStock > 0 && `, ${a.outOfStock} already out of stock`}
          </p>
          <p className="mt-0.5 text-slate-600 dark:text-slate-300">
            {names.join(', ')}
            {more > 0 && ` and ${more} more`}.
          </p>
          {prepare.isError && (
            <p className="mt-1 text-rose-700 dark:text-rose-400" role="alert">
              {prepare.error instanceof ApiError
                ? prepare.error.message
                : 'Could not prepare a plan'}
            </p>
          )}
        </div>
      </div>
      {a.openPlan ? (
        <Link to={`/restock/plans/${a.openPlan.id}`} className={buttonClass({ size: 'sm' })}>
          Review plan {a.openPlan.planNumber} <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : can('purchases:manage') ? (
        <Button
          size="sm"
          loading={prepare.isPending}
          onClick={() => prepare.mutate({ source: 'alert' })}
        >
          <Sparkles className="size-4" aria-hidden />
          Prepare restock plan
        </Button>
      ) : (
        <Link to="/restock" className={buttonClass({ size: 'sm', variant: 'secondary' })}>
          See Smart Restock <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </Callout>
  );
}
