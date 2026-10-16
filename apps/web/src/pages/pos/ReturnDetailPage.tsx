import {
  amountInWords,
  formatINR,
  getStateName,
  PAYMENT_METHOD_LABELS,
  type SaleReturnDto,
} from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { formatDateTime, formatQuantity } from '@/lib/format';
import { creditNotePdf } from '@/lib/invoice';
import { usePdfActions } from '@/lib/usePdfActions';

const stateLabel = (code: string) => `${getStateName(code) ?? code} (${code})`;

export function ReturnDetailPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['returns', 'detail', id],
    queryFn: () => apiFetch<{ saleReturn: SaleReturnDto }>(`/returns/${id}`),
    select: (r) => r.saleReturn,
  });
  const pdf = usePdfActions(query.data && creditNotePdf(query.data));

  if (query.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading return" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorAlert>Could not load this return. {(query.error as Error).message}</ErrorAlert>;
  }
  const r = query.data;

  return (
    <div className="space-y-6">
      <Link
        to="/pos/returns"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="size-4" aria-hidden /> Returns
      </Link>
      <PageHeader
        title={r.returnNumber}
        description={`Credit note · ${formatDateTime(r.returnedAt)} · by ${r.processedBy.name}`}
        actions={
          <>
            <Button
              variant="secondary"
              loading={pdf.busy === 'print'}
              onClick={() => pdf.run('print')}
            >
              <Printer className="size-4" aria-hidden />
              Print credit note
            </Button>
            <Button loading={pdf.busy === 'download'} onClick={() => pdf.run('download')}>
              <Download className="size-4" aria-hidden />
              Download PDF
            </Button>
          </>
        }
      />
      {pdf.error && <ErrorAlert>{pdf.error}</ErrorAlert>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Against invoice</h2>
          <p className="mt-2 text-sm">
            <Link
              to={`/pos/sales/${r.sale.id}`}
              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {r.sale.invoiceNumber}
            </Link>
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Sold {formatDateTime(r.soldAt)} · {stateLabel(r.placeOfSupply)}
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Customer</h2>
          {r.customer ? (
            <div className="mt-2 space-y-1 text-sm">
              {r.customer.id ? (
                <Link
                  to={`/customers/${r.customer.id}`}
                  className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {r.customer.name}
                </Link>
              ) : (
                <p className="font-medium">{r.customer.name}</p>
              )}
              {r.customer.phone && <p className="text-slate-500">{r.customer.phone}</p>}
              {r.customer.gstin && <p>GSTIN {r.customer.gstin}</p>}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Walk-in customer</p>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Refunded by</h2>
          <p className="mt-2 text-sm">
            {PAYMENT_METHOD_LABELS[r.refundMethod]}
            {r.refundReference && (
              <span className="text-xs text-slate-500"> · ref. {r.refundReference}</span>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Reason: {r.reason}</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Items returned</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Item
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Qty
                </th>
                <th scope="col" className="hidden px-4 py-3 text-right font-medium md:table-cell">
                  Taxable
                </th>
                <th scope="col" className="hidden px-4 py-3 text-right font-medium md:table-cell">
                  GST
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {r.items.map((i) => (
                <tr key={i.product.id}>
                  <td className="px-4 py-3">
                    <Link
                      to={`/products/${i.product.id}`}
                      className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {i.product.name}
                    </Link>{' '}
                    {!i.restock && <Badge tone="amber">Not restocked</Badge>}
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {i.product.sku} · HSN {i.hsnCode}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                    {formatQuantity(i.quantity, i.product.unit)}
                  </td>
                  <td className="hidden px-4 py-3 text-right whitespace-nowrap tabular-nums md:table-cell">
                    {formatINR(i.taxable)}
                  </td>
                  <td className="hidden px-4 py-3 text-right whitespace-nowrap tabular-nums md:table-cell">
                    {formatINR(i.cgst + i.sgst + i.igst)}
                    <div className="text-xs text-slate-500">{i.gstRate}%</div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                    {formatINR(i.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-6 border-t border-slate-200 p-5 sm:flex-row sm:justify-between dark:border-slate-800">
          <div className="text-sm">
            <p className="text-xs text-slate-500 dark:text-slate-400">Amount in words</p>
            <p className="font-medium">{amountInWords(r.totalRefund)}</p>
          </div>
          <dl className="w-full max-w-xs space-y-1.5 text-sm" aria-label="Credit note totals">
            <Row label="Taxable value" value={formatINR(r.taxable)} />
            {r.interState ? (
              <Row label="IGST" value={formatINR(r.igst)} />
            ) : (
              <>
                <Row label="CGST" value={formatINR(r.cgst)} />
                <Row label="SGST" value={formatINR(r.sgst)} />
              </>
            )}
            {r.roundOff !== 0 && (
              <Row
                label="Round off"
                value={`${r.roundOff > 0 ? '+' : '−'}${formatINR(Math.abs(r.roundOff))}`}
              />
            )}
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
              <dt className="font-semibold">Refund</dt>
              <dd className="text-xl font-semibold">{formatINR(r.totalRefund)}</dd>
            </div>
          </dl>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
