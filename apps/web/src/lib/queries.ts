import type { CategoryDto, SettingsDto, SupplierDto } from '@ims/shared';
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

/** The shop's own details (name, GSTIN, state). Rarely changes, so cache it for the session. */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ settings: SettingsDto }>('/settings'),
    select: (r) => r.settings,
    staleTime: Infinity,
  });
}
