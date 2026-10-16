import type { CustomerSummaryDto, Paginated } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Input } from './ui/Input';

/** Search-as-you-type customer chooser (an ARIA combobox) by name, phone or GSTIN. */
export function CustomerPicker({ onSelect }: { onSelect(customer: CustomerSummaryDto): void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['customer-picker', term],
    queryFn: () =>
      apiFetch<Paginated<CustomerSummaryDto>>(
        `/customers?${new URLSearchParams({ search: term, pageSize: '8' })}`,
      ),
    enabled: term.length >= 2,
    staleTime: 30_000,
  });
  const options = term === text.trim() && term.length >= 2 ? (results.data?.data ?? []) : [];
  const showList = open && text.trim().length >= 2;

  const choose = (customer: CustomerSummaryDto) => {
    onSelect(customer);
    setText('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && options.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp' && options.length > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        Find customer
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <Input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={showList && options[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off"
        placeholder="Name, phone or GSTIN"
        className="pl-9"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          aria-label="Matching customers"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {results.isFetching && options.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>
          )}
          {!results.isFetching && options.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">No customers found.</li>
          )}
          {options.map((c, index) => (
            <li
              key={c.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
              onMouseEnter={() => setActive(index)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                index === active && 'bg-indigo-50 dark:bg-indigo-500/10',
              )}
            >
              <span className="block font-medium">{c.name}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {[c.phone, c.gstin].filter(Boolean).join(' · ') || 'No phone on record'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
