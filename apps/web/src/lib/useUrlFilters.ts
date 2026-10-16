import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Filters kept in the URL, so the back button and shared links keep them.
 *
 * React Router's functional setParams(prev => …) receives the params of the render it was
 * created in, so a delayed update (e.g. a debounced search) could restore a filter the user had
 * just cleared. `update` always starts from the latest params instead.
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);

  /** Sets or (with null/'') removes keys. Any change except to `page` goes back to page 1. */
  const update = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(latest.current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!('page' in changes)) next.delete('page');
      latest.current = next;
      setParams(next, { replace: true });
    },
    [setParams],
  );

  const clear = useCallback(() => {
    latest.current = new URLSearchParams();
    setParams({}, { replace: true });
  }, [setParams]);

  return { params, update, clear };
}
