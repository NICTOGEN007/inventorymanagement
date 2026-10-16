import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, ROLE_LABELS, ROLES, type UserDto } from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import { ApiError, apiFetch, fieldErrors } from '@/lib/api';

const editSchema = createUserSchema
  .pick({ name: true, role: true })
  .extend({ isActive: z.boolean() });
type CreateValues = z.input<typeof createUserSchema>;
type EditValues = z.input<typeof editSchema>;

interface Props {
  /** The user to edit, or `null` to add a new one. */
  user: UserDto | null;
  open: boolean;
  onClose(): void;
}

export function UserFormDialog({ user, open, onClose }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? 'Edit user' : 'Add user'}
      description={user ? user.email : 'They can sign in straight away with this password.'}
    >
      {user ? (
        <EditUserForm key={user.id} user={user} onDone={onClose} />
      ) : (
        <CreateUserForm onDone={onClose} />
      )}
    </Dialog>
  );
}

function useSaveError() {
  const [message, setMessage] = useState<string | null>(null);
  return {
    message,
    clear: () => setMessage(null),
    handle(err: unknown, setError: (field: never, error: { message: string }) => void) {
      const fields = fieldErrors(err);
      Object.entries(fields).forEach(([field, msg]) => setError(field as never, { message: msg }));
      if (Object.keys(fields).length === 0) {
        setMessage(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
      }
    },
  };
}

const RoleOptions = () =>
  ROLES.map((role) => (
    <option key={role} value={role}>
      {ROLE_LABELS[role]}
    </option>
  ));

function CreateUserForm({ onDone }: { onDone(): void }) {
  const queryClient = useQueryClient();
  const saveError = useSaveError();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', role: 'cashier', password: '' },
  });
  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (values: CreateValues) =>
      apiFetch<{ user: UserDto }>('/users', { method: 'POST', body: values }),
    onSuccess: ({ user }) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`${user.name} can now sign in`);
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        form.setError('email', { message: err.message });
      } else saveError.handle(err, form.setError as never);
    },
  });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((values) => {
        saveError.clear();
        mutation.mutate(values);
      })}
    >
      {saveError.message && <ErrorAlert>{saveError.message}</ErrorAlert>}
      <Field label="Full name" error={errors.name?.message}>
        <Input autoComplete="off" {...form.register('name')} />
      </Field>
      <Field label="Email" error={errors.email?.message}>
        <Input type="email" autoComplete="off" {...form.register('email')} />
      </Field>
      <Field
        label="Role"
        error={errors.role?.message}
        hint="Cashiers bill sales; managers run stock and reports."
      >
        <Select {...form.register('role')}>
          <RoleOptions />
        </Select>
      </Field>
      <Field
        label="Temporary password"
        error={errors.password?.message}
        hint="At least 8 characters, with a letter and a number."
      >
        <Input type="text" autoComplete="new-password" {...form.register('password')} />
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Add user
        </Button>
      </div>
    </form>
  );
}

function EditUserForm({ user, onDone }: { user: UserDto; onDone(): void }) {
  const queryClient = useQueryClient();
  const { user: me, setUser } = useAuth();
  const isSelf = me?.id === user.id;
  const saveError = useSaveError();
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: user.name, role: user.role, isActive: user.isActive },
  });
  const { errors, dirtyFields } = form.formState;

  const mutation = useMutation({
    mutationFn: (changes: Partial<EditValues>) =>
      apiFetch<{ user: UserDto }>(`/users/${user.id}`, { method: 'PATCH', body: changes }),
    onSuccess: ({ user: updated }) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      if (isSelf) setUser(updated);
      toast.success('Changes saved');
      onDone();
    },
    onError: (err) => saveError.handle(err, form.setError as never),
  });

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((values) => {
        saveError.clear();
        const changes = Object.fromEntries(
          Object.entries(values).filter(([key]) => dirtyFields[key as keyof EditValues]),
        );
        if (Object.keys(changes).length === 0) return onDone();
        mutation.mutate(changes);
      })}
    >
      {saveError.message && <ErrorAlert>{saveError.message}</ErrorAlert>}
      <Field label="Full name" error={errors.name?.message}>
        <Input autoComplete="off" {...form.register('name')} />
      </Field>
      <Field
        label="Role"
        error={errors.role?.message}
        hint={isSelf ? "You can't change your own role." : undefined}
      >
        <Select disabled={isSelf} {...form.register('role')}>
          <RoleOptions />
        </Select>
      </Field>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          disabled={isSelf}
          className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          {...form.register('isActive')}
        />
        <span>
          <span className="font-medium">Active</span>
          <span className="block text-slate-500 dark:text-slate-400">
            Inactive users cannot sign in and are signed out immediately.
          </span>
        </span>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
