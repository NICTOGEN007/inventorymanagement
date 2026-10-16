import {
  allowsFractions,
  formatINR,
  getStateName,
  OPEN_PURCHASE_ORDER_STATUSES,
  type PurchaseOrderDto,
} from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, Pencil, Send, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { PurchaseStatusBadge } from '@/components/PurchaseStatusBadge';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError, apiFetch } from '@/lib/api';
import { formatDate, formatDateTime, formatQuantity } from '@/lib/format';

export function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const query = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => apiFetch<{ purchaseOrder: PurchaseOrderDto }>(`/purchase-orders/${id}`),
  });

  const refresh = (po: PurchaseOrderDto) => {
    queryClient.setQueryData(['purchase-order', po.id], { purchaseOrder: po });
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['product'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['movements'] });
  };

  const place = useMutation({
    mutationFn: () =>
      apiFetch<{ purchaseOrder: PurchaseOrderDto }>(`/purchase-orders/${id}/place`, {
        method: 'POST',
      }),
    onSuccess: ({ purchaseOrder }) => {
      refresh(purchaseOrder);
      toast.success(`${purchaseOrder.poNumber} placed with ${purchaseOrder.supplier.name}`);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not place the order'),
  });

  if (query.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading purchase order" />
      </div>
    );
  }
  if (query.isError)
    return <ErrorAlert>Could not load the order. {(query.error as Error).message}</ErrorAlert>;

  const po = query.data.purchaseOrder;
  const isOpen = OPEN_PURCHASE_ORDER_STATUSES.includes(po.status);
  const canManage = can('purchases:manage');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          to="/purchases"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Purchases
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{po.poNumber}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span>{po.supplier.name}</span>
              <PurchaseStatusBadge status={po.status} overdue={po.overdue} />
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {po.status === 'draft' && (
                <>
                  <Link
                    to={`/purchases/${po.id}/edit`}
                    className={buttonClass({ variant: 'secondary' })}
                  >
                    <Pencil className="size-4" aria-hidden />
                    Edit
                  </Link>
                  <Button loading={place.isPending} onClick={() => place.mutate()}>
                    <Send className="size-4" aria-hidden />
                    Place order
                  </Button>
                </>
              )}
              {isOpen && (
                <Button onClick={() => setReceiving(true)}>
                  <PackageCheck className="size-4" aria-hidden />
                  Receive goods
                </Button>
              )}
              {(po.status === 'draft' || isOpen) && (
                <Button variant="secondary" onClick={() => setCancelling(true)}>
                  <XCircle className="size-4" aria-hidden />
                  {po.status === 'partially_received' ? 'Close order' : 'Cancel order'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6">
          <h2 className="text-base font-semibold">Supplier</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Name" value={po.supplierDetails.name} />
            <Row label="GSTIN" value={po.supplierDetails.gstin ?? '—'} />
            <Row
              label="State"
              value={getStateName(po.supplierDetails.stateCode) ?? po.supplierDetails.stateCode}
            />
            <Row label="Tax" value={po.interState ? 'IGST' : 'CGST + SGST'} />
            {po.supplierDetails.phone && <Row label="Phone" value={po.supplierDetails.phone} />}
          </dl>
        </Card>
        <Card className="p-6">
          <h2 className="text-base font-semibold">Dates</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Created" value={formatDate(po.createdAt)} />
            <Row label="Ordered" value={po.orderedAt ? formatDate(po.orderedAt) : 'Not yet'} />
            <Row label="Expected" value={po.expectedAt ? formatDate(po.expectedAt) : '—'} />
            {po.receivedAt && <Row label="Received" value={formatDate(po.receivedAt)} />}
            {po.cancelledAt && (
              <Row
                label={po.status === 'closed' ? 'Closed' : 'Cancelled'}
                value={formatDate(po.cancelledAt)}
              />
            )}
          </dl>
        </Card>
        <Card className="p-6">
          <h2 className="text-base font-semibold">Amount</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Before GST" value={formatINR(po.taxable)} />
            {po.interState ? (
              <Row label="IGST" value={formatINR(po.igst)} />
            ) : (
              <>
                <Row label="CGST" value={formatINR(po.cgst)} />
                <Row label="SGST" value={formatINR(po.sgst)} />
              </>
            )}
            <div className="flex justify-between gap-4 border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-800">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatINR(po.total)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      {po.cancelReason && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <span className="font-medium">
            {po.status === 'closed' ? 'Closed short' : 'Cancelled'}:
          </span>{' '}
          {po.cancelReason}
        </Card>
      )}

      <Card className="overflow-hidden">
        <h2 className="border-b border-slate-200 px-6 py-4 text-base font-semibold dark:border-slate-800">
          Items
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
              <tr>
                <th scope="col" className="px-6 py-2 font-medium">
                  Product
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Ordered
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Received
                </th>
                <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                  Cost / unit
                </th>
                <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">
                  GST
                </th>
                <th scope="col" className="px-6 py-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {po.items.map((item) => (
                <tr key={item.product.id}>
                  <td className="px-6 py-3">
                    <Link
                      to={`/products/${item.product.id}`}
                      className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {item.product.name}
                    </Link>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {item.product.sku}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                    {formatQuantity(item.quantity, item.product.unit)}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                    {formatQuantity(item.receivedQuantity, item.product.unit)}
                    {isOpen && item.remainingQuantity > 0 && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatQuantity(item.remainingQuantity, item.product.unit)} to come
                      </div>
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-right whitespace-nowrap tabular-nums sm:table-cell">
                    {formatINR(item.unitCost)}
                  </td>
                  <td className="hidden px-3 py-3 text-right whitespace-nowrap tabular-nums md:table-cell">
                    {item.gstRate}%
                  </td>
                  <td className="px-6 py-3 text-right font-medium whitespace-nowrap tabular-nums">
                    {formatINR(item.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {po.receipts.length > 0 && (
        <Card className="p-6">
          <h2 className="text-base font-semibold">Deliveries</h2>
          <ol className="mt-4 space-y-4">
            {po.receipts.map((r, i) => (
              <li key={i} className="text-sm">
                <div className="font-medium">
                  {formatDateTime(r.receivedAt)}
                  {r.supplierInvoiceNumber && (
                    <span className="font-normal text-slate-500">
                      {' '}
                      · bill {r.supplierInvoiceNumber}
                    </span>
                  )}
                  {r.receivedBy && (
                    <span className="font-normal text-slate-500"> · {r.receivedBy.name}</span>
                  )}
                </div>
                <div className="mt-1 text-slate-600 dark:text-slate-300">
                  {r.items.map((item) => `${item.product.name} × ${item.quantity}`).join(', ')}
                </div>
                {r.note && <div className="mt-1 text-slate-500 dark:text-slate-400">{r.note}</div>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {po.notes && (
        <Card className="p-6 text-sm">
          <h2 className="text-base font-semibold">Notes</h2>
          <p className="mt-2 whitespace-pre-line text-slate-600 dark:text-slate-300">{po.notes}</p>
        </Card>
      )}

      <ReceiveDialog
        order={po}
        open={receiving}
        onClose={() => setReceiving(false)}
        onDone={refresh}
      />
      <CancelDialog
        order={po}
        open={cancelling}
        onClose={() => setCancelling(false)}
        onDone={refresh}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

interface DialogProps {
  order: PurchaseOrderDto;
  open: boolean;
  onClose(): void;
  onDone(po: PurchaseOrderDto): void;
}

/** Records a delivery. Quantities default to everything still outstanding. */
function ReceiveDialog({ order, open, onClose, onDone }: DialogProps) {
  const pending = order.items.filter((i) => i.remainingQuantity > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const valueFor = (productId: string, remaining: number) =>
    quantities[productId] ?? String(remaining);

  const receive = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch<{ purchaseOrder: PurchaseOrderDto }>(`/purchase-orders/${order.id}/receive`, {
        method: 'POST',
        body,
      }),
    onSuccess: ({ purchaseOrder }) => {
      onDone(purchaseOrder);
      toast.success(
        purchaseOrder.status === 'received'
          ? 'All goods received and added to stock'
          : 'Delivery recorded and added to stock',
      );
      setQuantities({});
      setInvoiceNumber('');
      setNote('');
      onClose();
    },
  });

  const submit = () => {
    const next: Record<string, string> = {};
    const items: { product: string; quantity: number }[] = [];
    for (const item of pending) {
      const text = valueFor(item.product.id, item.remainingQuantity).trim();
      if (text === '' || text === '0') continue;
      const qty = Number(text);
      if (!(qty > 0)) next[item.product.id] = 'Enter a quantity';
      else if (qty > item.remainingQuantity + 1e-9)
        next[item.product.id] = `At most ${item.remainingQuantity}`;
      else if (!allowsFractions(item.product.unit) && !Number.isInteger(qty))
        next[item.product.id] = `Whole ${item.product.unit} only`;
      else items.push({ product: item.product.id, quantity: qty });
    }
    if (Object.keys(next).length === 0 && items.length === 0)
      next.form = 'Enter at least one received quantity';
    setErrors(next);
    if (Object.keys(next).length === 0)
      receive.mutate({ items, supplierInvoiceNumber: invoiceNumber, note });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Receive goods"
      description="Received items are added to stock straight away."
    >
      <div className="space-y-4">
        {receive.error && (
          <ErrorAlert>
            {receive.error instanceof ApiError
              ? receive.error.message
              : 'Could not record the delivery'}
          </ErrorAlert>
        )}
        {errors.form && <ErrorAlert>{errors.form}</ErrorAlert>}
        <ul className="space-y-3">
          {pending.map((item) => (
            <li key={item.product.id} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0 pt-2">
                <div className="truncate font-medium">{item.product.name}</div>
                <div className="text-xs text-slate-500">
                  {formatQuantity(item.remainingQuantity, item.product.unit)} to come
                </div>
              </div>
              <div className="w-28 shrink-0">
                <Input
                  aria-label={`Received quantity of ${item.product.name}`}
                  inputMode="decimal"
                  invalid={!!errors[item.product.id]}
                  value={valueFor(item.product.id, item.remainingQuantity)}
                  onChange={(e) =>
                    setQuantities((q) => ({ ...q, [item.product.id]: e.target.value }))
                  }
                />
                {errors[item.product.id] && (
                  <p className="mt-1 text-xs text-rose-600">{errors[item.product.id]}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
        <Field label="Supplier's bill number (optional)">
          <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. 2 cartons damaged, refused"
          />
        </Field>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Each product's cost price becomes the weighted average of the stock already on the shelf
          and this delivery.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={receive.isPending} onClick={submit}>
            Add to stock
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CancelDialog({ order, open, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState('');
  const closing = order.status === 'partially_received';
  const cancel = useMutation({
    mutationFn: () =>
      apiFetch<{ purchaseOrder: PurchaseOrderDto }>(`/purchase-orders/${order.id}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: ({ purchaseOrder }) => {
      onDone(purchaseOrder);
      toast.success(closing ? 'Order closed; the rest will not be expected' : 'Order cancelled');
      onClose();
    },
  });
  const tooShort = reason.trim().length < 3;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={closing ? 'Close this order?' : 'Cancel this order?'}
      description={
        closing
          ? 'Goods already received stay in stock; the rest will no longer be expected.'
          : 'The order stays in the records, marked as cancelled.'
      }
    >
      <div className="space-y-4">
        {cancel.error && (
          <ErrorAlert>
            {cancel.error instanceof ApiError ? cancel.error.message : 'Could not cancel'}
          </ErrorAlert>
        )}
        <Field label="Reason">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Supplier cannot deliver"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Keep order
          </Button>
          <Button
            variant="danger"
            disabled={tooShort}
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {closing ? 'Close order' : 'Cancel order'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
