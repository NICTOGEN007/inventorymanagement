import { zodResolver } from '@hookform/resolvers/zod';
import {
  INDIAN_STATES,
  isStateCode,
  supplierInputSchema,
  type SupplierDto,
  type SupplierFormValues,
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

interface Props {
  supplier: SupplierDto | null;
  open: boolean;
  onClose(): void;
}

export function SupplierFormDialog({ supplier, open, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={supplier ? 'Edit supplier' : 'Add supplier'}>
      <SupplierForm key={supplier?.id ?? 'new'} supplier={supplier} onDone={onClose} />
    </Dialog>
  );
}

function defaults(s: SupplierDto | null): SupplierFormValues {
  return {
    name: s?.name ?? '',
    contactPerson: s?.contactPerson ?? '',
    phone: s?.phone ?? '',
    email: s?.email ?? '',
    gstin: s?.gstin ?? '',
    stateCode: s?.stateCode ?? '29',
    address: {
      line1: s?.address?.line1 ?? '',
      line2: s?.address?.line2 ?? '',
      city: s?.address?.city ?? '',
      pincode: s?.address?.pincode ?? '',
    },
    leadTimeDays: s?.leadTimeDays ?? 3,
    isActive: s?.isActive ?? true,
  };
}

function SupplierForm({ supplier, onDone }: { supplier: SupplierDto | null; onDone(): void }) {
  const queryClient = useQueryClient();
  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierInputSchema),
    defaultValues: defaults(supplier),
  });
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (values: SupplierFormValues) =>
      supplier
        ? apiFetch(`/suppliers/${supplier.id}`, { method: 'PUT', body: values })
        : apiFetch('/suppliers', { method: 'POST', body: values }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(supplier ? 'Supplier updated' : 'Supplier added');
      onDone();
    },
    onError: (err) => {
      for (const [field, message] of Object.entries(fieldErrors(err))) {
        form.setError(field as keyof SupplierFormValues, { message });
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

  return (
    <form noValidate className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      {general && <ErrorAlert>{general}</ErrorAlert>}
      <Field label="Business name" error={errors.name?.message}>
        <Input {...form.register('name')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact person" error={errors.contactPerson?.message}>
          <Input {...form.register('contactPerson')} />
        </Field>
        <Field label="Mobile" error={errors.phone?.message}>
          <Input inputMode="tel" {...form.register('phone')} />
        </Field>
      </div>
      <Field label="Email" error={errors.email?.message}>
        <Input type="email" {...form.register('email')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="GSTIN" error={errors.gstin?.message} hint="Sets the state automatically.">
          <Input className="uppercase" autoComplete="off" {...gstinField} />
        </Field>
        <Field
          label="State"
          error={errors.stateCode?.message}
          hint="Decides CGST + SGST or IGST on purchases."
        >
          <Select {...form.register('stateCode')}>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" error={errors.address?.city?.message}>
          <Input {...form.register('address.city')} />
        </Field>
        <Field label="PIN code" error={errors.address?.pincode?.message}>
          <Input inputMode="numeric" {...form.register('address.pincode')} />
        </Field>
      </div>
      <Field
        label="Delivery time (days)"
        error={errors.leadTimeDays?.message}
        hint="Typical days from order to delivery; used for restock planning."
      >
        <Input
          type="number"
          min={0}
          max={90}
          {...form.register('leadTimeDays', { valueAsNumber: true })}
        />
      </Field>
      {supplier && (
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-indigo-600"
            {...form.register('isActive')}
          />
          Active (can receive new purchase orders)
        </label>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {supplier ? 'Save changes' : 'Add supplier'}
        </Button>
      </div>
    </form>
  );
}
