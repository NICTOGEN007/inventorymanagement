import { cn } from '@/lib/cn';
import { istDateInput } from '@/lib/format';

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

/** Quick date ranges; the selected one is the one matching the current from/to. */
export function PeriodChips({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange(range: { from: string | null; to: string | null }): void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
      {ranges().map((r) => {
        const selected = r.from === from && r.to === to;
        return (
          <button
            key={r.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange({ from: r.from || null, to: r.to || null })}
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
  );
}
