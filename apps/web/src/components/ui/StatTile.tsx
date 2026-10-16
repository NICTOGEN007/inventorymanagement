import type { ReactNode } from 'react';
import { Card } from './Card';

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small supporting line under the value. */
  detail?: ReactNode;
  icon?: ReactNode;
}

/** One headline number. Large values use proportional figures (no tabular-nums). */
export function StatTile({ label, value, detail, icon }: StatTileProps) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
    </Card>
  );
}
