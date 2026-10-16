import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { Card } from '@/components/ui/Card';
import { apiFetch, type HealthResponse } from '@/lib/api';

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage() {
  const { user } = useAuth();
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
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {greeting(new Date().getHours())}, {user?.name.split(' ')[0]}. Sales and stock insights
          arrive in step 9.
        </p>
      </div>
      <Card className="inline-flex items-center gap-2 px-4 py-3 text-sm">
        <span className={`size-2.5 rounded-full ${status.className}`} aria-hidden />
        <span role="status">{status.label}</span>
      </Card>
    </div>
  );
}
