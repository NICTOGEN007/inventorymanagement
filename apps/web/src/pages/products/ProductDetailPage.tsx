import {
  formatINR,
  priceBreakdown,
  type Paginated,
  type ProductDto,
  type StockMovementDto,
} from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { MovementBadge } from '@/components/MovementBadge';
import { StockBadge } from '@/components/StockBadge';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { formatChange, formatDateTime, formatQuantity } from '@/lib/format';

export function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const query = useQuery({
    queryKey: ['product', id],
    queryFn: () => apiFetch<{ product: ProductDto }>(`/products/${id}`),
  });

  if (query.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading product" />
      </div>
    );
  }
  if (query.isError)
    return <ErrorAlert>Could not load the product. {(query.error as Error).message}</ErrorAlert>;

  const p = query.data.product;
  const price = priceBreakdown({ ...p, costPrice: p.costPrice ?? 0 });
  const showCost = p.costPrice !== undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          to="/products"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Products
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{p.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span>{p.sku}</span>
              <span aria-hidden>·</span>
              <span>{p.category.name}</span>
              <StockBadge status={p.stockStatus} />
              {!p.isActive && <Badge>Inactive</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            {can('inventory:adjust') && (
              <Link
                to={`/inventory/adjust?product=${p.id}`}
                className={buttonClass({ variant: 'secondary' })}
              >
                Adjust stock
              </Link>
            )}
            {can('products:write') && (
              <Link to={`/products/${p.id}/edit`} className={buttonClass({ variant: 'secondary' })}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="text-base font-semibold">Price</h2>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-3xl font-semibold tabular-nums">{formatINR(price.priceWithTax)}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                per {p.unit}, including {p.gstRate}% GST
                {p.mrp !== undefined && ` · MRP ${formatINR(p.mrp)}`}
              </p>
            </div>
            <dl className="space-y-2 text-sm">
              <Row label="Before GST" value={formatINR(price.taxable)} />
              <Row label={`GST (${p.gstRate}%)`} value={formatINR(price.gst)} />
              {showCost && <Row label="Cost (excl. GST)" value={formatINR(p.costPrice!)} />}
              {showCost && (
                <Row
                  label="Margin"
                  value={
                    <span
                      className={
                        price.margin < 0
                          ? 'text-rose-600'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }
                    >
                      {formatINR(price.margin)}
                      {price.marginPercent !== null && ` (${price.marginPercent}%)`}
                    </span>
                  }
                />
              )}
            </dl>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-base font-semibold">Stock</h2>
          <p className="mt-4 text-3xl font-semibold tabular-nums">
            {formatQuantity(p.stock, p.unit)}
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">on hand</p>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Reorder level" value={formatQuantity(p.reorderLevel, p.unit)} />
            <Row label="Usual order" value={formatQuantity(p.reorderQuantity, p.unit)} />
            <Row
              label="On order"
              value={p.onOrder > 0 ? formatQuantity(p.onOrder, p.unit) : 'Nothing'}
            />
          </dl>
        </Card>

        <Card className="p-6 lg:col-span-3">
          <h2 className="text-base font-semibold">Details</h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Row label="Barcode" value={p.barcode ?? '—'} />
            <Row label="HSN code" value={p.hsnCode} />
            <Row label="Unit" value={p.unit} />
            <Row label="Brand" value={p.brand ?? '—'} />
            <Row label="Preferred supplier" value={p.preferredSupplier?.name ?? '—'} />
            <Row label="Last changed" value={formatDateTime(p.updatedAt)} />
          </dl>
          {p.description && (
            <p className="mt-6 text-sm whitespace-pre-line text-slate-600 dark:text-slate-300">
              {p.description}
            </p>
          )}
        </Card>

        {can('inventory:read') && <StockHistory product={p} />}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function StockHistory({ product }: { product: ProductDto }) {
  const history = useQuery({
    queryKey: ['movements', `product=${product.id}&pageSize=8`],
    queryFn: () =>
      apiFetch<Paginated<StockMovementDto>>(
        `/inventory/movements?product=${product.id}&pageSize=8`,
      ),
  });
  return (
    <Card className="overflow-hidden lg:col-span-3">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <h2 className="text-base font-semibold">Recent stock changes</h2>
        <Link
          to={`/inventory/movements?product=${product.id}`}
          className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Full history
        </Link>
      </div>
      {history.isPending ? (
        <div className="flex justify-center p-6">
          <Spinner label="Loading stock history" />
        </div>
      ) : history.data?.data.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">No stock changes yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {history.data?.data.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm"
            >
              <div className="flex min-w-0 items-center gap-3">
                <MovementBadge movement={m} />
                <span className="truncate text-slate-500 dark:text-slate-400">
                  {formatDateTime(m.occurredAt)}
                  {m.reference && ` · ${m.reference.number}`}
                </span>
              </div>
              <span className="tabular-nums">
                <span className="font-medium">{formatChange(m.quantity, product.unit)}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {' '}
                  → {formatQuantity(m.balanceAfter, product.unit)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
