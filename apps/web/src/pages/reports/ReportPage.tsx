import { presetPeriod, type ReportDto, type ReportKind } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { TrendChart } from '@/components/charts/TrendChart';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatAxisINR, formatDateKey } from '@/lib/format';
import { downloadFile } from '@/lib/invoice';
import { useCategories } from '@/lib/queries';
import { useUrlFilters } from '@/lib/useUrlFilters';
import { formatCell, ReportSectionTable } from './ReportSectionTable';
import { REPORT_TABS } from './tabs';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'thisFy', label: 'This financial year' },
] as const;

const DESCRIPTIONS: Record<ReportKind, string> = {
  sales: 'Sales, refunds and gross profit over time, by payment method and by cashier.',
  products: 'What sold, what came back and what each product and category earned.',
  gst: 'Output tax, credit notes, input tax credit and the HSN summary for your GST returns.',
  stock: 'What the stock is worth, what is running low and what is not selling.',
};

/** Filters each report understands, besides the period. */
const FILTERS: Record<ReportKind, string[]> = {
  sales: ['from', 'to', 'groupBy'],
  products: ['from', 'to', 'sort', 'category'],
  gst: ['from', 'to'],
  stock: ['stock', 'category'],
};

export function ReportPage({ kind }: { kind: ReportKind }) {
  const { params, update } = useUrlFilters();
  const categories = useCategories();
  const [busy, setBusy] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const query = new URLSearchParams();
  for (const key of FILTERS[kind]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const report = useQuery({
    queryKey: ['reports', kind, query.toString()],
    queryFn: () => apiFetch<{ report: ReportDto }>(`/reports/${kind}?${query}`),
    select: (r) => r.report,
    placeholderData: (previous) => previous,
  });
  const r = report.data?.kind === kind ? report.data : undefined;
  const period = r?.period;

  const download = async (format: 'pdf' | 'csv', section?: string) => {
    if (!r) return;
    const q = new URLSearchParams(query);
    if (period) {
      q.set('from', period.from);
      q.set('to', period.to);
    }
    q.set('format', format);
    if (section) q.set('section', section);
    const stem = `${kind}-report-${period ? `${period.from}-to-${period.to}` : r.generatedAt.slice(0, 10)}`;
    setBusy(section ?? format);
    setDownloadError(null);
    try {
      await downloadFile(
        `/reports/${kind}?${q}`,
        `${stem}${section ? `-${section}` : ''}.${format}`,
      );
    } catch (err) {
      setDownloadError(`Could not download the ${format.toUpperCase()}. ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const periods = r?.kind === 'sales' ? r.sections.find((s) => s.id === 'periods') : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={DESCRIPTIONS[kind]}
        tabs={REPORT_TABS}
        actions={
          <Button loading={busy === 'pdf'} disabled={!r} onClick={() => download('pdf')}>
            <FileDown className="size-4" aria-hidden />
            Download PDF
          </Button>
        }
      />

      <div className="space-y-3">
        {kind !== 'stock' && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
            {PRESETS.map((p) => {
              const preset = presetPeriod(p.id);
              const selected = period?.from === preset.from && period.to === preset.to;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update(preset)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm',
                    selected
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {kind !== 'stock' && (
            <>
              <div className="w-40">
                <Input
                  type="date"
                  aria-label="From"
                  value={params.get('from') ?? period?.from ?? ''}
                  max={params.get('to') ?? period?.to}
                  onChange={(e) =>
                    update({ from: e.target.value, to: params.get('to') ?? period?.to ?? null })
                  }
                />
              </div>
              <div className="w-40">
                <Input
                  type="date"
                  aria-label="To"
                  value={params.get('to') ?? period?.to ?? ''}
                  min={params.get('from') ?? period?.from}
                  onChange={(e) =>
                    update({ to: e.target.value, from: params.get('from') ?? period?.from ?? null })
                  }
                />
              </div>
            </>
          )}
          {kind === 'sales' && (
            <div className="w-40">
              <Select
                aria-label="Group by"
                value={params.get('groupBy') ?? 'day'}
                onChange={(e) =>
                  update({ groupBy: e.target.value === 'day' ? null : e.target.value })
                }
              >
                <option value="day">By day</option>
                <option value="week">By week</option>
                <option value="month">By month</option>
              </Select>
            </div>
          )}
          {kind === 'products' && (
            <div className="w-44">
              <Select
                aria-label="Sort by"
                value={params.get('sort') ?? 'sales'}
                onChange={(e) =>
                  update({ sort: e.target.value === 'sales' ? null : e.target.value })
                }
              >
                <option value="sales">Most sales</option>
                <option value="profit">Most profit</option>
                <option value="quantity">Most sold (quantity)</option>
              </Select>
            </div>
          )}
          {kind === 'stock' && (
            <div className="w-48">
              <Select
                aria-label="Show"
                value={params.get('stock') ?? 'all'}
                onChange={(e) =>
                  update({ stock: e.target.value === 'all' ? null : e.target.value })
                }
              >
                <option value="all">All products</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
                <option value="dead">Not selling (60 days)</option>
              </Select>
            </div>
          )}
          {(kind === 'products' || kind === 'stock') && (
            <div className="w-48">
              <Select
                aria-label="Category"
                value={params.get('category') ?? ''}
                onChange={(e) => update({ category: e.target.value || null })}
              >
                <option value="">All categories</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      {report.isError && (
        <ErrorAlert>Could not load the report. {(report.error as Error).message}</ErrorAlert>
      )}
      {downloadError && <ErrorAlert>{downloadError}</ErrorAlert>}

      {!r ? (
        report.isPending || report.isFetching ? (
          <div className="flex justify-center p-16">
            <Spinner label="Loading the report" />
          </div>
        ) : null
      ) : (
        <div className={cn('space-y-8', report.isFetching && 'opacity-60 transition-opacity')}>
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {r.title} · {r.subtitle}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
              {r.highlights.map((h) => (
                <Card key={h.label} className="p-4">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">{h.label}</dt>
                  <dd
                    className={cn(
                      'mt-1 font-semibold tracking-tight break-words',
                      h.type === 'text' ? 'truncate text-base' : 'text-lg sm:text-xl',
                    )}
                    title={typeof h.value === 'string' ? h.value : undefined}
                  >
                    {formatCell(h.value, h.type)}
                  </dd>
                </Card>
              ))}
            </dl>
          </div>

          {periods && periods.rows.length > 1 && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold">Net sales</h2>
              <TrendChart
                label="Net sales"
                formatValue={(v) => formatCell(v, 'money')}
                formatTick={formatAxisINR}
                points={periods.rows.map((row) => {
                  const bucket = String(row.bucket);
                  const grouping = params.get('groupBy') ?? 'day';
                  return {
                    key: bucket,
                    label: grouping === 'day' ? formatDateKey(bucket, 'short') : String(row.period),
                    title: grouping === 'day' ? formatDateKey(bucket) : String(row.period),
                    value: Number(row.netSales),
                    details: [
                      { label: 'bills', value: formatCell(row.bills, 'number') },
                      { label: 'gross profit', value: formatCell(row.grossProfit, 'money') },
                    ],
                  };
                })}
              />
            </Card>
          )}

          {r.sections.map((section) => (
            <ReportSectionTable
              key={section.id}
              section={section}
              csvBusy={busy === section.id}
              onCsv={() => download('csv', section.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
