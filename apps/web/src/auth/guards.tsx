import type { Permission } from '@ims/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Spinner } from '@/components/ui/Spinner';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { useAuth } from './AuthProvider';

/** Shows the page only to signed-in users; others go to the login page and come back after. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useAuth();
  return can(permission) ? children : <ForbiddenPage />;
}

/** Where a user lands after signing in: cashiers go straight to billing. */
export function homePathFor(canSeeDashboard: boolean): string {
  return canSeeDashboard ? '/' : '/pos';
}
