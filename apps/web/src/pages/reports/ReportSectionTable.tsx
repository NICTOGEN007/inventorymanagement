import { formatINR, type ReportCell, type ReportColumn, type ReportSection } from '@ims/shared';
import { Download } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

export function formatCell(value: ReportCell | undefined, type: ReportColumn['type']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (type === 'money') return value < 0 ? `−${formatINR(-value)}` : formatINR(value);
  if (type === 'percent') return `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
  return value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

interface Props {
  section: ReportSection;
  onCsv(): void;
  csvBusy: boolean;
}

/** One table of a report, with its totals row and a CSV download. */
export function ReportSectionTable({ section, onCsv, csvBusy }: Props) {
  const headingId = `report-${section.id}`;
  const numeric = (c: ReportColumn) => c.type !== 'text';
  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold">
            {section.title}
          </h2>
          {section.description && (
            <p className="mt-0.5 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
              {section.description}
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={csvBusy}
          disabled={section.rows.length === 0}
          onClick={onCsv}
          aria-label={`Download ${section.title} as CSV`}
        >
          <Download className="size-4" aria-hidden />
          CSV
        </Button>
      </div>
      <Card className="overflow-hidden">
        {section.rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {section.empty ?? 'Nothing to show.'}
          </p>
        ) : (
          <div className="max-h-[36rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{section.title}</caption>
              <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  {section.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={cn(
                        'px-4 py-3 font-medium whitespace-nowrap',
                        numeric(c) && 'text-right',
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {section.rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    {section.columns.map((c, ci) => {
                      const value = formatCell(row[c.key], c.type);
                      const productId =
                        ci === 0 && typeof row.productId === 'string' && row.productId;
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            'px-4 py-2.5',
                            numeric(c)
                              ? 'text-right whitespace-nowrap tabular-nums'
                              : ci === 0
                                ? 'min-w-48'
                                : 'min-w-24',
                            ci === 0 && 'font-medium',
                          )}
                        >
                          {productId ? (
                            <Link
                              to={`/products/${productId}`}
                              className="hover:text-indigo-600 dark:hover:text-indigo-400"
                            >
                              {value}
                            </Link>
                          ) : (
                            value
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {section.totals && (
                <tfoot className="sticky bottom-0 border-t-2 border-slate-300 bg-white font-semibold dark:border-slate-700 dark:bg-slate-900">
                  <tr>
                    {section.columns.map((c, ci) => (
                      <td
                        key={c.key}
                        className={cn(
                          'px-4 py-3',
                          numeric(c) && 'text-right whitespace-nowrap tabular-nums',
                        )}
                      >
                        {section.totals![c.key] === undefined && ci > 0
                          ? ''
                          : formatCell(section.totals![c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
