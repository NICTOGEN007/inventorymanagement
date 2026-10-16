import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { RequireAuth, RequirePermission } from '@/auth/guards';
import { Layout } from '@/components/Layout';
import { NAV_ITEMS } from '@/navigation';
import { AccountPage } from '@/pages/AccountPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { UsersPage } from '@/pages/users/UsersPage';

/** Modules built in later steps; each is already guarded by its permission. */
const PLANNED = NAV_ITEMS.filter((item) => !['/', '/users'].includes(item.to));

function HomeRoute() {
  const { can } = useAuth();
  return can('reports:read') ? <DashboardPage /> : <Navigate to="/pos" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<HomeRoute />} />
          {PLANNED.map(({ to, label, permission }) => (
            <Route
              key={to}
              path={to.slice(1)}
              element={
                <RequirePermission permission={permission}>
                  <ComingSoonPage title={label} />
                </RequirePermission>
              }
            />
          ))}
          <Route
            path="users"
            element={
              <RequirePermission permission="users:manage">
                <UsersPage />
              </RequirePermission>
            }
          />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
