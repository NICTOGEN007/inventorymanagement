import { useQuery } from '@tanstack/react-query';
import { APP_NAME } from '@ims/shared';
import { apiFetch, type HealthResponse } from '@/lib/api';

export function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    retry: false,
  });

  const status = health.isPending
    ? { label: 'Checking…', className: 'bg-slate-400' }
    : health.data?.status === 'ok'
      ? { label: 'API and database online', className: 'bg-emerald-500' }
      : { label: 'API or database unreachable', className: 'bg-rose-500' };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{APP_NAME}</p>
      </div>
      <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
        <span className={`size-2.5 rounded-full ${status.className}`} aria-hidden />
        <span role="status">{status.label}</span>
      </div>
    </div>
  );
}
