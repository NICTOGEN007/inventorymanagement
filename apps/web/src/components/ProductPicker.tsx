import { formatINR, type Paginated, type ProductDto } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { ScanBarcode } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError, apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatQuantity } from '@/lib/format';
import { Input } from './ui/Input';

interface ProductPickerProps {
  onSelect(product: ProductDto): void;
  /** Products already chosen; shown but not selectable. */
  excludeIds?: readonly string[];
  /** Include deactivated products (e.g. to write off their remaining stock). */
  includeInactive?: boolean;
  placeholder?: string;
  label?: string;
  autoFocus?: boolean;
}

/**
 * Search-as-you-type product chooser (an ARIA combobox).
 *
 * Arrow keys move through results and Enter picks one. A barcode scanner types the code and
 * presses Enter faster than a search can return, so Enter with no matching result looks the
 * code up exactly instead.
 */
export function ProductPicker({
  onSelect,
  excludeIds = [],
  includeInactive = false,
  placeholder = 'Search or scan a product',
  label = 'Find product',
  autoFocus,
}: ProductPickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['product-picker', term, includeInactive],
    queryFn: () =>
      apiFetch<Paginated<ProductDto>>(
        `/products?${new URLSearchParams({ search: term, pageSize: '8', ...(includeInactive && { status: 'all' }) })}`,
      ),
    enabled: term.length > 0,
    staleTime: 10_000,
  });
  const options = term === text.trim() ? (results.data?.data ?? []) : [];
  const excluded = new Set(excludeIds);

  const choose = (product: ProductDto) => {
    if (excluded.has(product.id)) return;
    onSelect(product);
    setText('');
    setTerm('');
    setOpen(false);
    setError(null);
    inputRef.current?.focus();
  };

  const lookupExact = async (code: string) => {
    try {
      const { product } = await apiFetch<{ product: ProductDto }>(
        `/products/lookup?${new URLSearchParams({ code })}`,
      );
      if (excluded.has(product.id)) setError(`${product.name} is already in the list`);
      else choose(product);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? `No product matches “${code}”`
          : 'Search failed',
      );
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && options.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp' && options.length > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const code = text.trim();
      if (!code) return;
      const highlighted = open ? options[active] : undefined;
      if (highlighted && !excluded.has(highlighted.id)) choose(highlighted);
      else void lookupExact(code);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const listboxId = `${id}-listbox`;
  const showList = open && text.trim().length > 0;

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <ScanBarcode
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="pl-9"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          setError(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {error && (
        <p role="alert" className="mt-1.5 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Matching products"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {results.isFetching && options.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>
          )}
          {!results.isFetching && term && options.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">
              No products found. Press Enter to look up a barcode.
            </li>
          )}
          {options.map((product, index) => {
            const taken = excluded.has(product.id);
            return (
              <li
                key={product.id}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={taken || undefined}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => choose(product)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm',
                  index === active && 'bg-indigo-50 dark:bg-indigo-500/10',
                  taken && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{product.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {product.sku} · {formatINR(product.sellingPrice)}
                    {!product.isActive && ' · inactive'}
                    {taken && ' · already added'}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {formatQuantity(product.stock, product.unit)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
