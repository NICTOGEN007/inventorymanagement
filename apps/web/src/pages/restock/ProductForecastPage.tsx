import { formatINR, type ProductForecastDto } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ForecastChart, type ForecastPoint } from '@/components/charts/ForecastChart';
import { formatRate, lastsLabel, RestockStatusBadge } from '@/components/RestockBadges';
import { ErrorAlert } from '@/components/ui/Alert';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { formatDateKey, formatQuantity } from '@/lib/format';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const METHODS = {
  'holt-winters':
    'Holt-Winters exponential smoothing: a level, a damped trend and a weekly pattern',
  'moving-average': 'Average of recent days (too little history for Holt-Winters yet)',
  none: 'No sales yet, so there is nothing to forecast from',
} as const;

const signed = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatRate(Math.abs(value))}`;

export function ProductForecastPage() {
  const { id } = useParams();
  const query = useQuery({
    queryKey: ['forecast', 'product', id],
    queryFn: () => apiFetch<{ forecast: ProductForecastDto }>(`/forecast/products/${id}`),
    select: (r) => r.forecast,
  });

  if (query.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading the forecast" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <ErrorAlert>Could not load the forecast. {(query.error as Error | null)?.message}</ErrorAlert>
    );
  }

  const { item, history, forecast, model, backtest } = query.data;
  const unit = item.product.unit;
  const points: ForecastPoint[] = [
    ...history.map((h) => ({
      date: h.date,
      label: formatDateKey(h.date, 'short'),
      title: formatDateKey(h.date),
      actual: h.quantity,
      stockedOut: h.stockedOut,
    })),
    ...forecast.map((f) => ({
      date: f.date,
      label: formatDateKey(f.date, 'short'),
      title: formatDateKey(f.date),
      expected: f.expected,
      low: f.low,
      high: f.high,
      ...(f.festival && { festival: f.festival }),
    })),
  ];
  const festivals = Object.entries(model.festivalUplift).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link
          to="/restock"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Smart Restock
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{item.product.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <RestockStatusBadge status={item.status} />
              <span>
                {item.product.sku}
                {item.supplier &&
                  ` · ${item.supplier.name}, delivers in ${item.supplier.leadTimeDays} days`}
              </span>
            </div>
          </div>
          <Link
            to={`/products/${item.product.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Product details <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Expected sales"
          value={`${formatRate(item.dailyDemand)} a day`}
          detail="Average over the next 7 days"
        />
        <StatTile
          label="Stock lasts"
          value={lastsLabel(item.daysUntilStockout, item.stock)}
          detail={`${formatQuantity(item.stock, unit)} in stock${item.onOrder > 0 ? `, ${formatQuantity(item.onOrder, unit)} on order` : ''}`}
        />
        <StatTile
          label="Reorder point"
          value={formatQuantity(Math.ceil(item.reorderPoint), unit)}
          detail={`Sales until a delivery (${formatRate(item.leadTimeDemand)}) + safety stock (${formatRate(item.safetyStock)})`}
        />
        <StatTile
          label="Suggested order"
          value={item.suggestedQuantity > 0 ? formatQuantity(item.suggestedQuantity, unit) : 'None'}
          detail={
            item.suggestedQuantity > 0
              ? `${formatINR(Math.round(item.suggestedQuantity * item.unitCost))} + ${item.gstRate}% GST${item.packSize > 1 ? `, packs of ${item.packSize}` : ''}`
              : 'Enough stock for now'
          }
        />
      </div>

      <Card className="p-6">
        <h2 className="text-base font-semibold">Why</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
          {item.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold">Daily sales: last 8 weeks and next 4</h2>
        <ForecastChart
          points={points}
          label={`${item.product.name} daily sales`}
          formatValue={(v) => formatRate(v)}
        />
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold">How this forecast is made</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {METHODS[model.method]}
          {model.method !== 'none' && `, learned from ${model.historyDays} days of sales.`} Days
          when the shelf was empty count as at least what sold, not as low demand.
        </p>
        {model.method === 'holt-winters' && (
          <div className="mt-4 grid gap-6 md:grid-cols-3">
            <div>
              <h3 className="text-sm font-medium">Weekly pattern</h3>
              <table className="mt-2 w-full text-sm">
                <caption className="sr-only">Units above or below a normal day, by weekday</caption>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {WEEKDAYS.map((d, i) => (
                    <tr key={d}>
                      <th
                        scope="row"
                        className="py-1 text-left font-normal text-slate-500 dark:text-slate-400"
                      >
                        {d}
                      </th>
                      <td className="py-1 text-right tabular-nums">
                        {signed(model.season[i] ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="text-sm font-medium">Festival lift</h3>
              {festivals.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {festivals.map(([name, lift]) => (
                    <li key={name} className="flex justify-between gap-4">
                      <span className="text-slate-500 dark:text-slate-400">{name}</span>
                      <span className="tabular-nums">{lift.toFixed(1)}×</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-4 border-t border-slate-200 pt-1 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Other festivals</span>
                    <span className="tabular-nums">{model.generalUplift.toFixed(1)}×</span>
                  </li>
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  No festivals in the sales history yet.
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                At the peak of the build-up, compared with a normal day.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium">Fitted settings</h3>
              <dl className="mt-2 space-y-1 text-sm">
                {(
                  [
                    ['Level (α)', model.alpha],
                    ['Trend (β)', model.beta],
                    ['Weekly pattern (γ)', model.gamma],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              {backtest && (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                  On the last {backtest.weeks === 1 ? 'week' : `${backtest.weeks} weeks`} of normal
                  trading, held back from fitting: weekly error{' '}
                  <span className="font-medium">{Math.round(backtest.mape)}%</span>, against{' '}
                  {Math.round(backtest.baselineMape)}% for a moving average.
                </p>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
