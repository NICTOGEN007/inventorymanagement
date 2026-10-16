import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema, ROLE_LABELS } from '@ims/shared';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorAlert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { ApiError, apiFetch, fieldErrors } from '@/lib/api';

const formSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'The new password must be different',
    path: ['newPassword'],
  });
type FormValues = z.infer<typeof formSchema>;

export function AccountPage() {
  const { user } = useAuth();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: FormValues) =>
      apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
    onSuccess: () => {
      form.reset();
      toast.success('Password changed. Your other devices have been signed out.');
    },
    onError: (err) => {
      for (const [field, message] of Object.entries(fieldErrors(err))) {
        form.setError(field as keyof FormValues, { message });
      }
    },
  });
  const generalError =
    mutation.error && Object.keys(fieldErrors(mutation.error)).length === 0
      ? mutation.error instanceof ApiError
        ? mutation.error.message
        : 'Something went wrong'
      : null;

  if (!user) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">My account</h1>

      <Card className="p-6">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Name</dt>
            <dd className="mt-1 font-medium">{user.name}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500 dark:text-slate-400">Email</dt>
            <dd className="mt-1 truncate font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">Role</dt>
            <dd className="mt-1">
              <Badge tone="indigo">{ROLE_LABELS[user.role]}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold">Change password</h2>
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          {generalError && <ErrorAlert>{generalError}</ErrorAlert>}
          <Field label="Current password" error={errors.currentPassword?.message}>
            <Input
              type="password"
              autoComplete="current-password"
              {...form.register('currentPassword')}
            />
          </Field>
          <Field
            label="New password"
            error={errors.newPassword?.message}
            hint="At least 8 characters, with a letter and a number."
          >
            <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
          </Field>
          <Field label="Confirm new password" error={errors.confirmPassword?.message}>
            <Input
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
          </Field>
          <Button type="submit" loading={mutation.isPending}>
            Change password
          </Button>
        </form>
      </Card>
    </div>
  );
}
