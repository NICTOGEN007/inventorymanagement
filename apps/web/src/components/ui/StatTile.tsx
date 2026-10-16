import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Card } from './Card';

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small supporting line under the value. */
  detail?: ReactNode;
  icon?: ReactNode;
  /**
   * Change against an earlier period, in percent (null when there is nothing to compare).
   * Shown with an arrow and words, so it never relies on colour alone.
   */
  change?: { percent: number | null; against: string; upIsGood?: boolean };
}

/** One headline number. Large values use proportional figures (no tabular-nums). */
export function StatTile({ label, value, detail, icon, change }: StatTileProps) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {change && <Change {...change} />}
      {detail && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
    </Card>
  );
}

function Change({ percent, against, upIsGood = true }: NonNullable<StatTileProps['change']>) {
  if (percent === null) {
    return (
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">No figures for {against}</p>
    );
  }
  const flat = Math.abs(percent) < 0.05;
  const good = flat ? null : percent > 0 === upIsGood;
  const Icon = flat ? Minus : percent > 0 ? ArrowUpRight : ArrowDownRight;
  const amount = `${Math.abs(percent).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 font-medium tabular-nums',
          good === true && 'text-emerald-700 dark:text-emerald-400',
          good === false && 'text-rose-700 dark:text-rose-400',
          good === null && 'text-slate-600 dark:text-slate-300',
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {flat ? 'No change' : `${percent > 0 ? '+' : '−'}${amount}`}
        <span className="sr-only">{flat ? '' : percent > 0 ? ' up' : ' down'}</span>
      </span>
      <span className="text-slate-500 dark:text-slate-400">vs {against}</span>
    </p>
  );
}
