import { formatINR, type Paginated, type ProductDto } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { StockBadge } from '@/components/StockBadge';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { formatQuantity } from '@/lib/format';
import { useCategories } from '@/lib/queries';
import { useUrlFilters } from '@/lib/useUrlFilters';

export const PRODUCT_TABS = [
  { to: '/products', label: 'Products' },
  { to: '/products/categories', label: 'Categories' },
];

const FILTER_KEYS = ['search', 'category', 'stock', 'status', 'sort'] as const;

export function ProductsPage() {
  const { can } = useAuth();
  const { params, update, clear } = useUrlFilters();
  const categories = useCategories();
  const [search, setSearch] = useState(params.get('search') ?? '');

  // Search after the user pauses typing, not on every keystroke.
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === (params.get('search') ?? '')) return;
    const timer = setTimeout(() => update({ search: trimmed || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams();
  for (const key of [...FILTER_KEYS, 'page'] as const) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const products = useQuery({
    queryKey: ['products', query.toString()],
    queryFn: () => apiFetch<Paginated<ProductDto>>(`/products?${query}`),
    placeholderData: (previous) => previous,
  });
  const hasFilters = FILTER_KEYS.some((key) => params.get(key));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Everything the shop sells, with prices, GST and stock."
        tabs={PRODUCT_TABS}
        actions={
          can('products:write') && (
            <Link to="/products/new" className={buttonClass()}>
              <Plus className="size-4" aria-hidden />
              Add product
            </Link>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search products"
            title="Search by name, SKU, barcode or brand"
            aria-label="Search products"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Category"
          value={params.get('category') ?? ''}
          onChange={(e) => update({ category: e.target.value })}
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Stock level"
          value={params.get('stock') ?? ''}
          onChange={(e) => update({ stock: e.target.value })}
        >
          <option value="">Any stock level</option>
          <option value="ok">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </Select>
        <Select
          aria-label="Status"
          value={params.get('status') ?? ''}
          onChange={(e) => update({ status: e.target.value })}
        >
          <option value="">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </Select>
        <Select
          aria-label="Sort by"
          value={params.get('sort') ?? ''}
          onChange={(e) => update({ sort: e.target.value })}
        >
          <option value="">Name A–Z</option>
          <option value="-stock">Most stock</option>
          <option value="stock">Least stock</option>
          <option value="-sellingPrice">Highest price</option>
          <option value="sellingPrice">Lowest price</option>
          <option value="-updatedAt">Recently changed</option>
        </Select>
      </div>

      {products.isError && (
        <ErrorAlert>Could not load products. {(products.error as Error).message}</ErrorAlert>
      )}

      <Card className="overflow-hidden">
        {products.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading products" />
          </div>
        ) : products.data?.data.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {hasFilters ? (
              <>
                No products match these filters.{' '}
                <button
                  type="button"
                  className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  onClick={() => {
                    setSearch('');
                    clear();
                  }}
                >
                  Clear filters
                </button>
              </>
            ) : (
              'No products yet.'
            )}
          </div>
        ) : (
          <>
            <div
              className={
                products.isFetching
                  ? 'overflow-x-auto opacity-60 transition-opacity'
                  : 'overflow-x-auto'
              }
            >
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Product
                    </th>
                    <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                      Category
                    </th>
                    <th
                      scope="col"
                      className="hidden px-4 py-3 text-right font-medium sm:table-cell"
                    >
                      Price
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Stock
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {products.data!.data.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <Link
                          to={`/products/${p.id}`}
                          className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                        >
                          {p.name}
                        </Link>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {p.sku}
                          {p.brand && ` · ${p.brand}`}
                          {!p.isActive && (
                            <span className="ml-2">
                              <Badge>Inactive</Badge>
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-sm tabular-nums sm:hidden">
                          {formatINR(p.sellingPrice)}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-slate-600 md:table-cell dark:text-slate-300">
                        {p.category.name}
                      </td>
                      <td className="hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell">
                        <div className="font-medium tabular-nums">{formatINR(p.sellingPrice)}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {p.taxInclusive ? 'incl.' : '+'} {p.gstRate}% GST
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="font-medium tabular-nums">
                          {formatQuantity(p.stock, p.unit)}
                        </div>
                        <div className="mt-1 flex justify-end gap-1">
                          {p.stockStatus !== 'ok' && <StockBadge status={p.stockStatus} />}
                          {p.onOrder > 0 && (
                            <Badge tone="indigo">
                              {formatQuantity(p.onOrder, p.unit)} on order
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination
                page={products.data!.page}
                pageSize={products.data!.pageSize}
                total={products.data!.total}
                onPage={(page) => update({ page: page > 1 ? String(page) : null })}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
