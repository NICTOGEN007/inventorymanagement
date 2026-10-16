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
import { CategoriesPage } from '@/pages/products/CategoriesPage';
import { ProductDetailPage } from '@/pages/products/ProductDetailPage';
import { ProductFormPage } from '@/pages/products/ProductFormPage';
import { ProductsPage } from '@/pages/products/ProductsPage';
import { SuppliersPage } from '@/pages/suppliers/SuppliersPage';
import { UsersPage } from '@/pages/users/UsersPage';
import type { Permission } from '@ims/shared';
import type { ReactNode } from 'react';

const guard = (permission: Permission, page: ReactNode) => (
  <RequirePermission permission={permission}>{page}</RequirePermission>
);

/** Modules built in later steps; each is already guarded by its permission. */
const BUILT = ['/', '/users', '/products', '/suppliers'];
const PLANNED = NAV_ITEMS.filter((item) => !BUILT.includes(item.to));

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
          <Route path="products" element={guard('products:read', <ProductsPage />)} />
          <Route path="products/new" element={guard('products:write', <ProductFormPage />)} />
          <Route path="products/categories" element={guard('products:read', <CategoriesPage />)} />
          <Route path="products/:id" element={guard('products:read', <ProductDetailPage />)} />
          <Route path="products/:id/edit" element={guard('products:write', <ProductFormPage />)} />
          <Route path="suppliers" element={guard('purchases:read', <SuppliersPage />)} />
          <Route path="users" element={guard('users:manage', <UsersPage />)} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
