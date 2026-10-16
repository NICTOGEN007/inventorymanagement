import {
  amountInWords,
  formatINR,
  getStateName,
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  type SaleDto,
} from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { formatDateTime, formatQuantity } from '@/lib/format';
import { downloadInvoice, printInvoice } from '@/lib/invoice';

const stateLabel = (code: string) => `${getStateName(code) ?? code} (${code})`;

export function SaleDetailPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: ['sales', 'detail', id],
    queryFn: () => apiFetch<{ sale: SaleDto }>(`/sales/${id}`),
    select: (r) => r.sale,
  });
  const [busy, setBusy] = useState<'print' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading sale" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorAlert>Could not load this sale. {(query.error as Error).message}</ErrorAlert>;
  }
  const sale = query.data;

  const run = async (kind: 'print' | 'download') => {
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'print' ? printInvoice(sale) : downloadInvoice(sale));
    } catch (err) {
      setError(`Could not get the invoice. ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/pos/sales"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="size-4" aria-hidden /> Sales
      </Link>
      <PageHeader
        title={sale.invoiceNumber}
        description={
          <>
            {formatDateTime(sale.soldAt)} · billed by {sale.cashier.name}{' '}
            {sale.status !== 'completed' && (
              <Badge tone="amber">{SALE_STATUS_LABELS[sale.status]}</Badge>
            )}
          </>
        }
        actions={
          <>
            <Button variant="secondary" loading={busy === 'print'} onClick={() => run('print')}>
              <Printer className="size-4" aria-hidden />
              Print invoice
            </Button>
            <Button loading={busy === 'download'} onClick={() => run('download')}>
              <Download className="size-4" aria-hidden />
              Download PDF
            </Button>
          </>
        }
      />
      {error && <ErrorAlert>{error}</ErrorAlert>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Customer</h2>
          {sale.customer ? (
            <dl className="mt-2 space-y-1 text-sm">
              <dd className="font-medium">{sale.customer.name}</dd>
              {sale.customer.phone && <dd className="text-slate-500">{sale.customer.phone}</dd>}
              {sale.customer.gstin && <dd>GSTIN {sale.customer.gstin}</dd>}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Walk-in customer</p>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Place of supply</h2>
          <p className="mt-2 text-sm">{stateLabel(sale.placeOfSupply)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {sale.interState ? 'Inter-state supply: IGST' : 'Within the state: CGST + SGST'}
          </p>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Paid by</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {sale.payments.map((p) => (
              <li key={p.method} className="flex justify-between gap-4">
                <span>
                  {PAYMENT_METHOD_LABELS[p.method]}
                  {p.reference && (
                    <span className="text-xs text-slate-500"> · ref. {p.reference}</span>
                  )}
                </span>
                <span className="tabular-nums">{formatINR(p.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Items</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Item
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Qty
                </th>
                <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                  Price
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
              {sale.items.map((i) => (
                <tr key={i.product.id}>
                  <td className="px-4 py-3">
                    <Link
                      to={`/products/${i.product.id}`}
                      className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {i.product.name}
                    </Link>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {i.product.sku} · HSN {i.hsnCode}
                      {i.discount > 0 && ` · discount ${formatINR(i.discount)}`}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                    {formatQuantity(i.quantity, i.product.unit)}
                  </td>
                  <td className="hidden px-4 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {formatINR(i.unitPrice)}
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
            <p className="font-medium">{amountInWords(sale.grandTotal)}</p>
          </div>
          <dl className="w-full max-w-xs space-y-1.5 text-sm" aria-label="Invoice totals">
            <Row label="Total before discount" value={formatINR(sale.gross)} />
            {sale.discount > 0 && <Row label="Discount" value={`−${formatINR(sale.discount)}`} />}
            <Row label="Taxable value" value={formatINR(sale.taxable)} />
            {sale.interState ? (
              <Row label="IGST" value={formatINR(sale.igst)} />
            ) : (
              <>
                <Row label="CGST" value={formatINR(sale.cgst)} />
                <Row label="SGST" value={formatINR(sale.sgst)} />
              </>
            )}
            {sale.roundOff !== 0 && (
              <Row
                label="Round off"
                value={`${sale.roundOff > 0 ? '+' : '−'}${formatINR(Math.abs(sale.roundOff))}`}
              />
            )}
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
              <dt className="font-semibold">Total</dt>
              <dd className="text-xl font-semibold">{formatINR(sale.grandTotal)}</dd>
            </div>
          </dl>
        </div>
      </Card>
      {sale.notes && <p className="text-sm text-slate-500">Note: {sale.notes}</p>}
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
