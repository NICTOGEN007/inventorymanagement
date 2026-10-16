export interface ShareSegment {
  key: string;
  label: string;
  value: number;
  /** A CSS colour, e.g. var(--chart-1). Slots are assigned per entity, never by rank. */
  color: string;
  display: string;
}

/**
 * Part-to-whole as one stacked bar (segments split by a 2px surface gap) with a legend that
 * carries every label, value and share, so nothing relies on colour alone.
 */
export function ShareBar({ segments, label }: { segments: ShareSegment[]; label: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  const share = (v: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);
  return (
    <div className="space-y-4">
      <div className="flex h-3 gap-0.5" role="img" aria-label={label}>
        {shown.map((s, i) => (
          <div
            key={s.key}
            title={`${s.label}: ${s.display} (${share(s.value)}%)`}
            className={i === shown.length - 1 ? 'rounded-r' : undefined}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <ul className="space-y-2 text-sm">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="tabular-nums">
              {s.display}
              <span className="ml-2 inline-block w-12 text-right text-slate-500 dark:text-slate-400">
                {share(s.value)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
