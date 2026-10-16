import { zodResolver } from '@hookform/resolvers/zod';
import { categoryInputSchema, type CategoryDto, type CategoryFormValues } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError, apiFetch, fieldErrors } from '@/lib/api';
import { useCategories } from '@/lib/queries';
import { PRODUCT_TABS } from './ProductsPage';

export function CategoriesPage() {
  const { can } = useAuth();
  const canWrite = can('products:write');
  const categories = useCategories();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CategoryDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<CategoryDto | null>(null);

  const remove = useMutation({
    mutationFn: (c: CategoryDto) => apiFetch(`/categories/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast.success('Category deleted');
      setDeleting(null);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Group products so they are easy to find and report on."
        tabs={PRODUCT_TABS}
        actions={
          canWrite && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" aria-hidden />
              Add category
            </Button>
          )
        }
      />

      {categories.isError && <ErrorAlert>Could not load categories.</ErrorAlert>}
      <Card className="overflow-hidden">
        {categories.isPending ? (
          <div className="flex justify-center p-10">
            <Spinner label="Loading categories" />
          </div>
        ) : categories.data?.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No categories yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Category
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Products
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {categories.data?.map((c) => (
                <tr key={c.id} className={c.isActive ? '' : 'opacity-60'}>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {c.name} {!c.isActive && <Badge>Inactive</Badge>}
                    </div>
                    {c.description && (
                      <div className="text-slate-500 dark:text-slate-400">{c.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <Link
                      to={`/products?category=${c.id}`}
                      className="text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {c.productCount}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(c)}
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        {c.productCount === 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleting(c)}
                            aria-label={`Delete ${c.name}`}
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
        )}
      </Card>

      <Dialog
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        title={editing ? 'Edit category' : 'Add category'}
      >
        <CategoryForm
          key={editing?.id ?? 'new'}
          category={editing ?? null}
          onDone={() => setEditing(undefined)}
        />
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete category?"
        confirmLabel="Delete"
        loading={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
      >
        “{deleting?.name}” has no products and will be removed permanently.
      </ConfirmDialog>
    </div>
  );
}

function CategoryForm({ category, onDone }: { category: CategoryDto | null; onDone(): void }) {
  const queryClient = useQueryClient();
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryInputSchema),
    defaultValues: {
      name: category?.name ?? '',
      description: category?.description ?? '',
      isActive: category?.isActive ?? true,
    },
  });
  const save = useMutation({
    mutationFn: (values: CategoryFormValues) =>
      category
        ? apiFetch(`/categories/${category.id}`, { method: 'PATCH', body: values })
        : apiFetch('/categories', { method: 'POST', body: values }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast.success(category ? 'Category updated' : 'Category added');
      onDone();
    },
    onError: (err) => {
      for (const [field, message] of Object.entries(fieldErrors(err))) {
        form.setError(field as keyof CategoryFormValues, { message });
      }
    },
  });
  const { errors } = form.formState;
  const general =
    save.error && Object.keys(fieldErrors(save.error)).length === 0
      ? (save.error as Error).message
      : null;

  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      {general && <ErrorAlert>{general}</ErrorAlert>}
      <Field label="Name" error={errors.name?.message}>
        <Input {...form.register('name')} />
      </Field>
      <Field label="Description (optional)" error={errors.description?.message}>
        <Textarea rows={2} {...form.register('description')} />
      </Field>
      {category && (
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-indigo-600"
            {...form.register('isActive')}
          />
          Active (shown when adding products)
        </label>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {category ? 'Save changes' : 'Add category'}
        </Button>
      </div>
    </form>
  );
}
