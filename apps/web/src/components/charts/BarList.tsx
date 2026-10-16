import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface BarListItem {
  key: string;
  label: string;
  to?: string;
  /** Under the label, e.g. "147 pcs". */
  detail?: ReactNode;
  value: number;
  /** The value as shown at the bar's end. */
  display: string;
}

/**
 * Ranked horizontal bars in one hue, each labelled with its value, so the list reads as a table
 * with lengths to compare.
 */
export function BarList({ items, label }: { items: BarListItem[]; label: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ol className="space-y-3" aria-label={label}>
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {item.to ? (
                <Link
                  to={item.to}
                  className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="font-medium">{item.label}</span>
              )}
              {item.detail && (
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                  {item.detail}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">{item.display}</span>
          </div>
          <div className="mt-1.5 h-2" aria-hidden>
            <div
              className="h-2 rounded-r bg-[var(--chart-1)]"
              style={{ width: `${max > 0 ? Math.max(1, (item.value / max) * 100) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
