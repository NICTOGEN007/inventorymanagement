import type { RestockAlertDto, RestockPlanDto } from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { apiFetch } from './api';

/** How many products need restocking, and any draft plan waiting for review. */
export function useRestockAlerts(enabled = true) {
  return useQuery({
    queryKey: ['restock-alerts'],
    queryFn: () => apiFetch<{ alerts: RestockAlertDto }>('/restock/alerts'),
    select: (r) => r.alerts,
    enabled,
  });
}

/** Invalidates everything a new or changed restock plan affects. */
export function useRestockRefresh() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [
      'restock-alerts',
      'restock-plans',
      'forecast',
      'purchase-orders',
      'products',
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** Prepares a draft plan from what needs reordering, then opens it. */
export function usePrepareRestockPlan() {
  const navigate = useNavigate();
  const refresh = useRestockRefresh();
  return useMutation({
    mutationFn: (body: { supplier?: string; budget?: number; source?: 'manual' | 'alert' }) =>
      apiFetch<{ plan: RestockPlanDto }>('/restock/plans', { method: 'POST', body }),
    onSuccess: ({ plan }) => {
      refresh();
      void navigate(`/restock/plans/${plan.id}`);
    },
  });
}
