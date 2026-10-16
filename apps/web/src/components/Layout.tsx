import { ROLE_LABELS } from '@ims/shared';
import { LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { NAV_ITEMS } from '@/navigation';

export function Layout() {
  const { theme, toggle } = useTheme();
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items = NAV_ITEMS.filter((item) => can(item.permission));

  const signOut = async () => {
    await logout().catch(() => undefined);
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 transform flex-col border-r border-slate-200 bg-white transition-transform md:static md:translate-x-0 dark:border-slate-800 dark:bg-slate-900',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-bold text-indigo-600 dark:text-indigo-400"
          >
            <img src="/favicon.svg" alt="" className="size-7" />
            StockSmart
          </Link>
          <button
            type="button"
            className="md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        {user && (
          <div className="border-t border-slate-200 p-3 dark:border-slate-800">
            <Link
              to="/account"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white"
                aria-hidden
              >
                {initials(user.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{user.name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {ROLE_LABELS[user.role]}
                </span>
              </span>
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        )}
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            className="md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={toggle}
            className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        </header>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
