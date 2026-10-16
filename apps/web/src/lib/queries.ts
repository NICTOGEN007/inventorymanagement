import type { CategoryDto, SupplierDto } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

/** All categories (small list, cached and shared by every screen that needs it). */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<{ data: CategoryDto[] }>('/categories'),
    select: (r) => r.data,
    staleTime: 5 * 60_000,
  });
}

export function useSuppliers({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<{ data: SupplierDto[] }>('/suppliers'),
    select: (r) => r.data,
    staleTime: 5 * 60_000,
    enabled,
  });
}
