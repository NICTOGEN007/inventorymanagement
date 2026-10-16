import { ROLE_LABELS, ROLES, type Role, type UserDto } from '@ims/shared';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { apiFetch } from '@/lib/api';
import { formatDateTime, formatRelative, initials } from '@/lib/format';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { UserFormDialog } from './UserFormDialog';

const ROLE_TONE: Record<Role, BadgeTone> = { admin: 'indigo', manager: 'amber', cashier: 'gray' };

export function UsersPage() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const deferredSearch = useDeferredValue(search.trim());
  const [editing, setEditing] = useState<UserDto | null | undefined>(undefined);
  const [resetting, setResetting] = useState<UserDto | null>(null);

  const params = new URLSearchParams();
  if (deferredSearch) params.set('search', deferredSearch);
  if (role) params.set('role', role);
  const query = useQuery({
    queryKey: ['users', deferredSearch, role],
    queryFn: () => apiFetch<{ data: UserDto[] }>(`/users?${params}`),
    placeholderData: (previous) => previous,
  });
  const users = query.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Staff accounts and what each person is allowed to do.
          </p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus className="size-4" aria-hidden />
          Add user
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search name or email"
            aria-label="Search users"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Filter by role"
          className="sm:w-40"
          value={role}
          onChange={(e) => setRole(e.target.value as Role | '')}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>

      {query.isError && (
        <ErrorAlert>Could not load users. {(query.error as Error).message}</ErrorAlert>
      )}

      <Card className="overflow-hidden">
        {query.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading users" />
          </div>
        ) : users.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No users match your filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Last sign-in
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((user) => (
                  <tr key={user.id} className={user.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          aria-hidden
                        >
                          {initials(user.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium">
                            {user.name}
                            {user.id === me?.id && (
                              <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>
                            )}
                          </div>
                          <div className="truncate text-slate-500 dark:text-slate-400">
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={user.isActive ? 'green' : 'red'}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                      {user.lastLoginAt ? (
                        <time dateTime={user.lastLoginAt} title={formatDateTime(user.lastLoginAt)}>
                          {formatRelative(user.lastLoginAt)}
                        </time>
                      ) : (
                        'Never'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(user)}
                          aria-label={`Edit ${user.name}`}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        {user.id !== me?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setResetting(user)}
                            aria-label={`Reset password for ${user.name}`}
                          >
                            <KeyRound className="size-4" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <UserFormDialog
        user={editing ?? null}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
      />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}
