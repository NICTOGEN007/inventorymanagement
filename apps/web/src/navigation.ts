import type { Permission } from '@ims/shared';
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  MessageSquareText,
  Package,
  ShoppingCart,
  Sparkles,
  Factory,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
}

/** Main menu. Items a user's role cannot use are hidden, and their routes are guarded. */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'reports:read' },
  { to: '/pos', label: 'Point of Sale', icon: ShoppingCart, permission: 'sales:create' },
  { to: '/products', label: 'Products', icon: Package, permission: 'products:read' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory:read' },
  { to: '/purchases', label: 'Purchases', icon: Truck, permission: 'purchases:read' },
  { to: '/restock', label: 'Smart Restock', icon: Sparkles, permission: 'forecast:read' },
  { to: '/suppliers', label: 'Suppliers', icon: Factory, permission: 'purchases:read' },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'customers:read' },
  { to: '/reports', label: 'Reports', icon: BarChart3, permission: 'reports:read' },
  { to: '/assistant', label: 'AI Assistant', icon: MessageSquareText, permission: 'assistant:use' },
  { to: '/users', label: 'Users', icon: UserCog, permission: 'users:manage' },
];
