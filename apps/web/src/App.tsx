import { Route, Routes } from 'react-router';
import { Layout } from '@/components/Layout';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const PLANNED = [
  ['pos', 'Point of Sale'],
  ['products', 'Products'],
  ['inventory', 'Inventory'],
  ['purchases', 'Purchases'],
  ['customers', 'Customers'],
  ['reports', 'Reports'],
  ['assistant', 'AI Assistant'],
] as const;

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        {PLANNED.map(([path, title]) => (
          <Route key={path} path={path} element={<ComingSoonPage title={title} />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
