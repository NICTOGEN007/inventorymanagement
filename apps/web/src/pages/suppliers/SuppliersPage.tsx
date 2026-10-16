import { getStateName, type SupplierDto } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { ApiError, apiFetch } from '@/lib/api';
import { useSuppliers } from '@/lib/queries';
import { SupplierFormDialog } from './SupplierFormDialog';

export function SuppliersPage() {
  const { can } = useAuth();
  const canManage = can('purchases:manage');
  const suppliers = useSuppliers();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<SupplierDto | null>(null);

  const remove = useMutation({
    mutationFn: (s: SupplierDto) => apiFetch(`/suppliers/${s.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier deleted');
      setDeleting(null);
    },
  });

  const needle = search.trim().toLowerCase();
  const visible = (suppliers.data ?? []).filter(
    (s) =>
      !needle ||
      [s.name, s.contactPerson, s.gstin, s.address?.city].some((v) =>
        v?.toLowerCase().includes(needle),
      ),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Who you buy from, their GSTIN, and how long deliveries take."
        actions={
          canManage && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" aria-hidden />
              Add supplier
            </Button>
          )
        }
      />

      <div className="relative max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="Search name, contact, GSTIN or city"
          aria-label="Search suppliers"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {suppliers.isError && <ErrorAlert>Could not load suppliers.</ErrorAlert>}
      <Card className="overflow-hidden">
        {suppliers.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading suppliers" />
          </div>
        ) : visible.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            {needle ? 'No suppliers match your search.' : 'No suppliers yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Supplier
                  </th>
                  <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">
                    GSTIN
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Delivery
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                    Products
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((s) => (
                  <tr key={s.id} className={s.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {s.name} {!s.isActive && <Badge>Inactive</Badge>}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        {[s.contactPerson, s.phone, s.address?.city ?? getStateName(s.stateCode)]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs md:table-cell">
                      {s.gstin ?? '—'}
                      <div className="font-sans text-slate-500 dark:text-slate-400">
                        {getStateName(s.stateCode)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {s.leadTimeDays} {s.leadTimeDays === 1 ? 'day' : 'days'}
                    </td>
                    <td className="hidden px-4 py-3 text-right tabular-nums sm:table-cell">
                      {s.productCount}
                    </td>
                    <td className="px-4 py-3">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(s)}
                            aria-label={`Edit ${s.name}`}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          {s.productCount === 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleting(s)}
                              aria-label={`Delete ${s.name}`}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SupplierFormDialog
        supplier={editing ?? null}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete supplier?"
        confirmLabel="Delete"
        loading={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
      >
        “{deleting?.name}” will be removed permanently. Suppliers with purchase orders can only be
        deactivated.
      </ConfirmDialog>
    </div>
  );
}
