import { rupeesToPaise } from '@ims/shared';
import { useState, type FormEvent } from 'react';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { ApiError } from '@/lib/api';
import { useSuppliers } from '@/lib/queries';
import { usePrepareRestockPlan } from '@/lib/restock';

const AMOUNT = /^\d+(\.\d{1,2})?$/;

export function PrepareRestockDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const suppliers = useSuppliers({ enabled: open });
  const prepare = usePrepareRestockPlan();
  const [supplier, setSupplier] = useState('');
  const [budget, setBudget] = useState('');
  const budgetError =
    budget.trim() !== '' && !AMOUNT.test(budget.trim()) ? 'Enter an amount like 50000' : undefined;

  const close = () => {
    prepare.reset();
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (budgetError) return;
    prepare.mutate({
      ...(supplier && { supplier }),
      ...(budget.trim() && { budget: rupeesToPaise(Number(budget.trim())) }),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Prepare a restock plan"
      description="The plan lists what to reorder, from the demand forecasts. Nothing is ordered until you confirm it."
    >
      <form className="space-y-4" onSubmit={submit} noValidate>
        {prepare.isError && (
          <ErrorAlert>
            {prepare.error instanceof ApiError
              ? prepare.error.message
              : 'Could not prepare the plan'}
          </ErrorAlert>
        )}
        <Field label="Supplier">
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.data
              ?.filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label="Budget (optional)"
          hint="Including GST. The most urgent items are covered first."
          error={budgetError}
        >
          <MoneyInput
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="No limit"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={prepare.isPending}>
            Prepare plan
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
