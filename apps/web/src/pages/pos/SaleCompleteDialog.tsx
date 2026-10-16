import { formatINR, type SaleDto } from '@ims/shared';
import { CheckCircle2, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { downloadInvoice, printInvoice } from '@/lib/invoice';

interface Props {
  completed: { sale: SaleDto; change: number } | null;
  onClose(): void;
}

/** Shown after a sale: the invoice number, change to hand back, and printing. */
export function SaleCompleteDialog({ completed, onClose }: Props) {
  const [busy, setBusy] = useState<'print' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sale = completed?.sale;

  const run = async (kind: 'print' | 'download') => {
    if (!sale) return;
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

  const close = () => {
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={!!completed}
      onClose={close}
      title="Sale complete"
      description={sale && `Invoice ${sale.invoiceNumber}`}
    >
      {sale && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-4 dark:bg-emerald-500/10">
            <CheckCircle2 className="size-6 shrink-0 text-emerald-600" aria-hidden />
            <div>
              <p className="text-2xl font-semibold tracking-tight">{formatINR(sale.grandTotal)}</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {sale.items.length} {sale.items.length === 1 ? 'item' : 'items'} ·{' '}
                {sale.customer?.name ?? 'Walk-in customer'}
              </p>
            </div>
          </div>
          {completed.change > 0 && (
            <p className="flex items-baseline justify-between text-lg font-semibold" role="status">
              <span>Change to return</span>
              <span>{formatINR(completed.change)}</span>
            </p>
          )}
          {error && <ErrorAlert>{error}</ErrorAlert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" loading={busy === 'print'} onClick={() => run('print')}>
              <Printer className="size-4" aria-hidden />
              Print invoice
            </Button>
            <Button
              variant="secondary"
              loading={busy === 'download'}
              onClick={() => run('download')}
            >
              <Download className="size-4" aria-hidden />
              Download PDF
            </Button>
            <Button autoFocus onClick={close}>
              New sale
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
