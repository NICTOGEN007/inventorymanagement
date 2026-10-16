import { zodResolver } from '@hookform/resolvers/zod';
import {
  customerInputSchema,
  getStateName,
  INDIAN_STATES,
  isStateCode,
  type CustomerDto,
  type CustomerFormValues,
} from '@ims/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import { apiFetch, fieldErrors } from '@/lib/api';
import { useSettings } from '@/lib/queries';

interface Props {
  /** The customer to edit, or null to add one. */
  customer: CustomerDto | null;
  open: boolean;
  onClose(): void;
  onSaved?(customer: CustomerDto): void;
}

export function CustomerFormDialog({ customer, open, onClose, onSaved }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={customer ? 'Edit customer' : 'Add customer'}>
      <CustomerForm
        key={customer?.id ?? 'new'}
        customer={customer}
        onDone={(saved) => {
          if (saved) onSaved?.(saved);
          onClose();
        }}
      />
    </Dialog>
  );
}

function defaults(c: CustomerDto | null): CustomerFormValues {
  return {
    name: c?.name ?? '',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    gstin: c?.gstin ?? '',
    stateCode: c?.stateCode ?? '',
    address: {
      line1: c?.address?.line1 ?? '',
      line2: c?.address?.line2 ?? '',
      city: c?.address?.city ?? '',
      pincode: c?.address?.pincode ?? '',
    },
    isActive: c?.isActive ?? true,
  };
}

function CustomerForm({
  customer,
  onDone,
}: {
  customer: CustomerDto | null;
  onDone(saved?: CustomerDto): void;
}) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerInputSchema),
    defaultValues: defaults(customer),
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: CustomerFormValues) =>
      customer
        ? apiFetch<{ customer: CustomerDto }>(`/customers/${customer.id}`, {
            method: 'PUT',
            body: values,
          })
        : apiFetch<{ customer: CustomerDto }>('/customers', { method: 'POST', body: values }),
    onSuccess: ({ customer: saved }) => {
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-picker'] });
      toast.success(customer ? 'Customer updated' : `${saved.name} added`);
      onDone(saved);
    },
    onError: (err) => {
      for (const [field, message] of Object.entries(fieldErrors(err))) {
        form.setError(field as keyof CustomerFormValues, { message });
      }
    },
  });
  const general =
    save.error && Object.keys(fieldErrors(save.error)).length === 0
      ? (save.error as Error).message
      : null;

  const gstinField = form.register('gstin', {
    // The first two digits of a GSTIN are the state code, so fill the state in for the user.
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const code = e.target.value.trim().slice(0, 2);
      if (isStateCode(code)) form.setValue('stateCode', code);
    },
  });
  const shopState = settings.data?.stateCode;

  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      {general && <ErrorAlert>{general}</ErrorAlert>}
      <Field label="Name" error={errors.name?.message}>
        <Input autoFocus {...form.register('name')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile" error={errors.phone?.message} hint="Used to find them at the till.">
          <Input inputMode="tel" autoComplete="off" {...form.register('phone')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="off" {...form.register('email')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="GSTIN"
          error={errors.gstin?.message}
          hint="For business customers. Sets the state."
        >
          <Input className="uppercase" autoComplete="off" {...gstinField} />
        </Field>
        <Field
          label="State"
          error={errors.stateCode?.message}
          hint="Another state means IGST on their bills."
        >
          <Select {...form.register('stateCode')}>
            <option value="">
              {shopState ? `Local (${getStateName(shopState)})` : "Local (the shop's state)"}
            </option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Address" error={errors.address?.line1?.message}>
        <Input autoComplete="off" {...form.register('address.line1')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" error={errors.address?.city?.message}>
          <Input autoComplete="off" {...form.register('address.city')} />
        </Field>
        <Field label="PIN code" error={errors.address?.pincode?.message}>
          <Input inputMode="numeric" autoComplete="off" {...form.register('address.pincode')} />
        </Field>
      </div>
      {customer && (
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-indigo-600"
            {...form.register('isActive')}
          />
          Active (can be put on new bills)
        </label>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {customer ? 'Save changes' : 'Add customer'}
        </Button>
      </div>
    </form>
  );
}
