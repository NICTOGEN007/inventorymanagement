import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional sub-navigation shown under the title. */
  tabs?: { to: string; label: string }[];
}

export function PageHeader({ title, description, actions, tabs }: PageHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {tabs && (
        <nav
          className="flex gap-1 border-b border-slate-200 dark:border-slate-800"
          aria-label={`${title} sections`}
        >
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end
              className={({ isActive }) =>
                cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
