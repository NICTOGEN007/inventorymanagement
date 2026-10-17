import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { niceStep, useWidth } from './scale';

export interface ForecastPoint {
  date: string;
  /** Short axis label, e.g. "16 Oct". */
  label: string;
  /** Tooltip heading, e.g. "Fri, 16 Oct 2026". */
  title: string;
  /** Units sold (past days). */
  actual?: number;
  /** The shelf was empty that night, so demand may have been higher. */
  stockedOut?: boolean;
  /** Forecast (coming days), with its 80% range. */
  expected?: number;
  low?: number;
  high?: number;
  festival?: string;
}

interface Props {
  points: ForecastPoint[];
  /** e.g. "Toned Milk 1 L daily sales"; names the chart for screen readers and the table. */
  label: string;
  formatValue(value: number): string;
  height?: number;
}

const MARGIN = { top: 12, right: 12, bottom: 26, left: 44 };

/**
 * Past daily sales (solid line) and the forecast after them (dashed line in a second colour,
 * inside a shaded 80% range). Days that ended with an empty shelf are shaded grey. Crosshair,
 * keyboard readout and a table view, as on the other charts.
 */
export function ForecastChart({ points, label, formatValue, height = 260 }: Props) {
  const id = useId();
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const max = Math.max(1, ...points.map((p) => Math.max(p.actual ?? 0, p.high ?? 0)));
  const step = niceStep(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const slot = plotW / Math.max(1, points.length - 1);
  const x = (i: number) => MARGIN.left + i * slot;
  const y = (v: number) => MARGIN.top + plotH - (Math.max(0, v) / top) * plotH;
  const path = (pairs: [number, number][]) =>
    pairs.map(([i, v], n) => `${n ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  const past = points.flatMap((p, i) =>
    p.actual !== undefined ? [[i, p.actual] as [number, number]] : [],
  );
  const lastPast = past.at(-1);
  const future = points.flatMap((p, i) =>
    p.expected !== undefined ? [[i, p.expected] as [number, number]] : [],
  );
  const firstFuture = future[0]?.[0];
  const bandTop = points.flatMap((p, i) =>
    p.high !== undefined ? [[i, p.high] as [number, number]] : [],
  );
  const bandBottom = points.flatMap((p, i) =>
    p.low !== undefined ? [[i, p.low] as [number, number]] : [],
  );
  const band =
    bandTop.length > 0 ? `${path(bandTop)}L${path([...bandBottom].reverse()).slice(1)}Z` : '';

  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 80))));
  const labelled = points
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % every === 0 && points.length - 1 - i >= every / 2);

  const nearest = (clientX: number, rect: DOMRect) =>
    Math.min(
      points.length - 1,
      Math.max(0, Math.round((clientX - rect.left - MARGIN.left) / slot)),
    );
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) =>
    setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const start = firstFuture ?? last;
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, (active ?? start) - 1),
      ArrowRight: Math.min(last, (active ?? start - 1) + 1),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]!);
    } else if (e.key === 'Escape') setActive(null);
  };

  const point = active !== null ? points[active] : undefined;
  const tipLeft = active !== null ? x(active) : 0;
  const flip = tipLeft > width * 0.6;
  const describe = (p: ForecastPoint) =>
    p.actual !== undefined
      ? `sold ${formatValue(p.actual)}${p.stockedOut ? ', shelf empty' : ''}`
      : `forecast ${formatValue(p.expected ?? 0)} (likely ${formatValue(p.low ?? 0)} to ${formatValue(p.high ?? 0)})${p.festival ? `, ${p.festival} build-up` : ''}`;

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[var(--chart-1)]" aria-hidden />
          Sold
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden>
            <line
              x1="0"
              x2="16"
              y1="2"
              y2="2"
              stroke="var(--chart-2)"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          </svg>
          Forecast
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm bg-[var(--chart-2)] opacity-20" aria-hidden />
          Likely range (80%)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm bg-[var(--chart-label)] opacity-25" aria-hidden />
          Shelf empty
        </li>
      </ul>
      <div
        ref={ref}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        tabIndex={0}
        role="group"
        aria-label={`${label} chart. Use the left and right arrow keys to read each day.`}
        aria-describedby={`${id}-readout`}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? firstFuture ?? points.length - 1)}
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
          {points.map((p, i) =>
            p.stockedOut ? (
              <rect
                key={`out-${p.date}`}
                x={x(i) - slot / 2}
                width={slot}
                y={MARGIN.top}
                height={plotH}
                fill="var(--chart-label)"
                fillOpacity={0.18}
              />
            ) : null,
          )}
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
                {formatValue(t)}
              </text>
            </g>
          ))}
          {labelled.map(({ p, i }) => (
            <text
              key={p.date}
              x={x(i)}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : 'middle'}
              fontSize={11}
              fill="var(--chart-label)"
            >
              {p.label}
            </text>
          ))}
          {firstFuture !== undefined && (
            <g>
              <line
                x1={x(firstFuture - 0.5)}
                x2={x(firstFuture - 0.5)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotH}
                stroke="var(--chart-axis)"
                strokeDasharray="2 3"
              />
              <text
                x={x(firstFuture - 0.5) + 4}
                y={MARGIN.top + 10}
                fontSize={11}
                fill="var(--chart-label)"
              >
                Today
              </text>
            </g>
          )}
          {band && <path d={band} fill="var(--chart-2)" fillOpacity={0.15} />}
          <path
            d={path(past)}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={path(lastPast ? [lastPast, ...future] : future)}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinejoin="round"
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
                cy={y(point.actual ?? point.expected ?? 0)}
                r={4}
                fill={point.actual !== undefined ? 'var(--chart-1)' : 'var(--chart-2)'}
                stroke="var(--chart-surface)"
                strokeWidth={2}
              />
            </>
          )}
        </svg>
        {point && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={
              flip ? { right: width - tipLeft + 10 } : { left: Math.min(tipLeft + 10, width - 170) }
            }
          >
            <p className="text-slate-500 dark:text-slate-400">{point.title}</p>
            {point.actual !== undefined ? (
              <>
                <p className="mt-0.5 flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded-full bg-[var(--chart-1)]" aria-hidden />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatValue(point.actual)}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">sold</span>
                </p>
                {point.stockedOut && (
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                    Shelf empty: demand may have been higher
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-0.5 flex items-center gap-2">
                  <span className="h-0.5 w-3 rounded-full bg-[var(--chart-2)]" aria-hidden />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatValue(point.expected ?? 0)}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">forecast</span>
                </p>
                <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                  Likely {formatValue(point.low ?? 0)} to {formatValue(point.high ?? 0)}
                </p>
                {point.festival && (
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">
                    {point.festival} build-up
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <p id={`${id}-readout`} className="sr-only" aria-live="polite">
          {point ? `${point.title}: ${describe(point)}` : ''}
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
                  Sold
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Forecast
                </th>
                <th scope="col" className="hidden py-1.5 text-right font-medium sm:table-cell">
                  Likely range
                </th>
                <th scope="col" className="py-1.5 pl-3 font-medium">
                  Note
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {points.map((p) => (
                <tr key={p.date}>
                  <td className="py-1.5 whitespace-nowrap">{p.title}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {p.actual !== undefined ? formatValue(p.actual) : '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {p.expected !== undefined ? formatValue(p.expected) : '—'}
                  </td>
                  <td className="hidden py-1.5 text-right tabular-nums sm:table-cell">
                    {p.expected !== undefined
                      ? `${formatValue(p.low ?? 0)}–${formatValue(p.high ?? 0)}`
                      : '—'}
                  </td>
                  <td className="py-1.5 pl-3 text-slate-500 dark:text-slate-400">
                    {p.stockedOut ? 'Shelf empty' : p.festival ? `${p.festival} build-up` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
