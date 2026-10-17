import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { niceStep, useWidth } from './scale';

export interface TrendPoint {
  key: string;
  /** Short axis label, e.g. "16 Oct". */
  label: string;
  /** Tooltip heading, e.g. "Fri, 16 Oct 2026". */
  title: string;
  value: number;
  /** Extra lines for the tooltip and table, e.g. bills and profit. */
  details?: { label: string; value: string }[];
}

interface Props {
  points: TrendPoint[];
  /** What is plotted, e.g. "Net sales"; names the chart for screen readers and the table. */
  label: string;
  formatValue(value: number): string;
  formatTick(value: number): string;
  height?: number;
}

const MARGIN = { top: 12, right: 12, bottom: 26, left: 52 };

/**
 * One series over time: a 2px line over a light wash, a crosshair that snaps to the nearest
 * day, the same readout from the keyboard (arrow keys), and a table with every value.
 */
export function TrendChart({ points, label, formatValue, formatTick, height = 220 }: Props) {
  const id = useId();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const max = Math.max(0, ...points.map((p) => p.value));
  const step = niceStep(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const x = (i: number) =>
    MARGIN.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => MARGIN.top + plotH - (Math.max(0, v) / top) * plotH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const area =
    points.length > 0
      ? `${line.join('')}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
      : '';
  // About six date labels, whatever the period.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 90))));
  const labelled = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % every === 0 || i === points.length - 1)
    .filter(({ i }, n, all) => i === points.length - 1 || all[n + 1]!.i - i >= every);

  const nearest = (clientX: number, rect: DOMRect) => {
    if (points.length <= 1) return 0;
    const ratio = (clientX - rect.left - MARGIN.left) / plotW;
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) =>
    setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, (active ?? last) - 1),
      ArrowRight: Math.min(last, (active ?? last) + 1),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]!);
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  };

  const point = active !== null ? points[active] : undefined;
  const tipLeft = active !== null ? x(active) : 0;
  const flip = tipLeft > width * 0.6;

  return (
    <div className="space-y-3">
      <div
        ref={ref}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        tabIndex={0}
        role="group"
        aria-label={`${label} chart. Use the left and right arrow keys to read each value.`}
        aria-describedby={`${id}-readout`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? points.length - 1)}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={height}
          className="block max-w-full touch-pan-y select-none"
          aria-hidden
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={MARGIN.left - 8}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--chart-label)"
                className="tabular-nums"
              >
                {formatTick(t)}
              </text>
            </g>
          ))}
          {labelled.map(({ p, i }) => (
            <text
              key={p.key}
              x={x(i)}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--chart-label)"
            >
              {p.label}
            </text>
          ))}
          <path d={area} fill="var(--chart-1)" fillOpacity={0.1} />
          <path
            d={line.join('')}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {point && active !== null && (
            <>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotH}
                stroke="var(--chart-axis)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <circle
                cx={x(active)}
                cy={y(point.value)}
                r={4}
                fill="var(--chart-1)"
                stroke="var(--chart-surface)"
                strokeWidth={2}
              />
            </>
          )}
          {points.length > 0 && active === null && (
            <circle
              cx={x(points.length - 1)}
              cy={y(points.at(-1)!.value)}
              r={4}
              fill="var(--chart-1)"
              stroke="var(--chart-surface)"
              strokeWidth={2}
            />
          )}
        </svg>
        {point && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={
              flip ? { right: width - tipLeft + 10 } : { left: Math.min(tipLeft + 10, width - 150) }
            }
          >
            <p className="text-slate-500 dark:text-slate-400">{point.title}</p>
            <p className="mt-0.5 flex items-center gap-2">
              <span className="h-0.5 w-3 rounded-full bg-[var(--chart-1)]" aria-hidden />
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {formatValue(point.value)}
              </span>
              <span className="text-slate-500 dark:text-slate-400">{label}</span>
            </p>
            {point.details?.map((d) => (
              <p key={d.label} className="mt-0.5 text-slate-600 dark:text-slate-300">
                <span className="font-medium">{d.value}</span> {d.label}
              </p>
            ))}
          </div>
        )}
        <p id={`${id}-readout`} className="sr-only" aria-live="polite">
          {point
            ? `${point.title}: ${label} ${formatValue(point.value)}${point.details?.map((d) => `, ${d.label} ${d.value}`).join('') ?? ''}`
            : ''}
        </p>
      </div>
      <button
        type="button"
        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        aria-expanded={showTable}
        aria-controls={`${id}-table`}
        onClick={() => setShowTable((s) => !s)}
      >
        {showTable ? 'Hide table' : 'Show as table'}
      </button>
      {showTable && (
        <div id={`${id}-table`} className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-white text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th scope="col" className="py-1.5 font-medium">
                  Date
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  {label}
                </th>
                {points[0]?.details?.map((d) => (
                  <th
                    key={d.label}
                    scope="col"
                    className="py-1.5 text-right font-medium capitalize"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {points.map((p) => (
                <tr key={p.key}>
                  <td className="py-1.5">{p.title}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatValue(p.value)}</td>
                  {p.details?.map((d) => (
                    <td key={d.label} className={cn('py-1.5 text-right tabular-nums')}>
                      {d.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
