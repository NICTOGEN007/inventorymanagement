import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, type ResetPasswordInput, type UserDto } from '@ims/shared';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { ApiError, apiFetch } from '@/lib/api';

export function ResetPasswordDialog({ user, onClose }: { user: UserDto | null; onClose(): void }) {
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: ResetPasswordInput) =>
      apiFetch(`/users/${user!.id}/reset-password`, { method: 'POST', body: values }),
    onSuccess: () => {
      toast.success(`Password reset for ${user!.name}. Share it with them securely.`);
      form.reset();
      onClose();
    },
  });

  return (
    <Dialog
      open={user !== null}
      onClose={() => {
        form.reset();
        mutation.reset();
        onClose();
      }}
      title="Reset password"
      description={user ? `${user.name} will be signed out of all devices.` : undefined}
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
      >
        {mutation.error && (
          <ErrorAlert>
            {mutation.error instanceof ApiError ? mutation.error.message : 'Something went wrong'}
          </ErrorAlert>
        )}
        <Field
          label="New password"
          error={form.formState.errors.password?.message}
          hint="At least 8 characters, with a letter and a number."
        >
          <Input type="text" autoComplete="new-password" {...form.register('password')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={mutation.isPending}>
            Reset password
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
