import { formatINR, type SaleList } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { SaleStatusBadge } from '@/components/SaleStatusBadge';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** Starts a return: find the customer's bill by invoice number, name or phone. */
export function FindInvoiceDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['sales', 'find', term],
    queryFn: () =>
      apiFetch<SaleList>(`/sales?${new URLSearchParams({ search: term, pageSize: '6' })}`),
    enabled: term.length >= 2,
  });
  const close = () => {
    setText('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Return items"
      description="Find the bill the goods were bought on."
    >
      <div className="space-y-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            type="search"
            autoFocus
            aria-label="Find the bill"
            placeholder="Invoice number, customer or phone"
            className="pl-9"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {term.length < 2 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            For example 42 or INV/26-27/00042, from the printed bill.
          </p>
        ) : results.isPending ? (
          <div className="flex justify-center p-4">
            <Spinner label="Searching" />
          </div>
        ) : results.isError ? (
          <p className="text-sm text-rose-600">Could not search bills.</p>
        ) : results.data.data.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No bills match “{term}”.</p>
        ) : (
          <ul
            className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
            aria-label="Matching bills"
          >
            {results.data.data.map((s) => (
              <li key={s.id}>
                {s.status === 'returned' ? (
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm opacity-60">
                    <span>
                      <span className="font-medium">{s.invoiceNumber}</span>{' '}
                      <SaleStatusBadge status={s.status} />
                      <span className="block text-xs text-slate-500">
                        {formatDateTime(s.soldAt)}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatINR(s.grandTotal)}</span>
                  </div>
                ) : (
                  <Link
                    to={`/pos/sales/${s.id}/return`}
                    onClick={close}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{s.invoiceNumber}</span>{' '}
                      <SaleStatusBadge status={s.status} />
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                        {formatDateTime(s.soldAt)} · {s.customer?.name ?? 'Walk-in customer'}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 tabular-nums">
                      {formatINR(s.grandTotal)}
                      <ChevronRight className="size-4 text-slate-400" aria-hidden />
                    </span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
