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
import { AdjustStockPage } from '@/pages/inventory/AdjustStockPage';
import { InventoryPage } from '@/pages/inventory/InventoryPage';
import { MovementsPage } from '@/pages/inventory/MovementsPage';
import { CustomerDetailPage } from '@/pages/customers/CustomerDetailPage';
import { CustomersPage } from '@/pages/customers/CustomersPage';
import { PosPage } from '@/pages/pos/PosPage';
import { ReturnDetailPage } from '@/pages/pos/ReturnDetailPage';
import { ReturnFormPage } from '@/pages/pos/ReturnFormPage';
import { ReturnsPage } from '@/pages/pos/ReturnsPage';
import { SaleDetailPage } from '@/pages/pos/SaleDetailPage';
import { SalesPage } from '@/pages/pos/SalesPage';
import { CategoriesPage } from '@/pages/products/CategoriesPage';
import { PurchaseOrderDetailPage } from '@/pages/purchases/PurchaseOrderDetailPage';
import { PurchaseOrderFormPage } from '@/pages/purchases/PurchaseOrderFormPage';
import { PurchasesPage } from '@/pages/purchases/PurchasesPage';
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
const BUILT = [
  '/',
  '/pos',
  '/users',
  '/products',
  '/suppliers',
  '/inventory',
  '/purchases',
  '/customers',
];
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
          <Route path="pos" element={guard('sales:create', <PosPage />)} />
          <Route path="pos/sales" element={guard('sales:read', <SalesPage />)} />
          <Route path="pos/sales/:id" element={guard('sales:read', <SaleDetailPage />)} />
          <Route
            path="pos/sales/:id/return"
            element={guard('returns:create', <ReturnFormPage />)}
          />
          <Route path="pos/returns" element={guard('sales:read', <ReturnsPage />)} />
          <Route path="pos/returns/:id" element={guard('sales:read', <ReturnDetailPage />)} />
          <Route path="customers" element={guard('customers:read', <CustomersPage />)} />
          <Route path="customers/:id" element={guard('customers:read', <CustomerDetailPage />)} />
          <Route path="products" element={guard('products:read', <ProductsPage />)} />
          <Route path="products/new" element={guard('products:write', <ProductFormPage />)} />
          <Route path="products/categories" element={guard('products:read', <CategoriesPage />)} />
          <Route path="products/:id" element={guard('products:read', <ProductDetailPage />)} />
          <Route path="products/:id/edit" element={guard('products:write', <ProductFormPage />)} />
          <Route path="inventory" element={guard('inventory:read', <InventoryPage />)} />
          <Route path="inventory/movements" element={guard('inventory:read', <MovementsPage />)} />
          <Route path="inventory/adjust" element={guard('inventory:adjust', <AdjustStockPage />)} />
          <Route path="purchases" element={guard('purchases:read', <PurchasesPage />)} />
          <Route
            path="purchases/new"
            element={guard('purchases:manage', <PurchaseOrderFormPage />)}
          />
          <Route
            path="purchases/:id"
            element={guard('purchases:read', <PurchaseOrderDetailPage />)}
          />
          <Route
            path="purchases/:id/edit"
            element={guard('purchases:manage', <PurchaseOrderFormPage />)}
          />
          <Route path="suppliers" element={guard('purchases:read', <SuppliersPage />)} />
          <Route path="users" element={guard('users:manage', <UsersPage />)} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
