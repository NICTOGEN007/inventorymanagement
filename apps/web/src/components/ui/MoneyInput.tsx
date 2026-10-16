import { forwardRef } from 'react';
import { Input, type InputProps } from './Input';

/** Rupee amount field with a ₹ prefix. Holds text like "617.50"; convert with rupeesToPaise. */
export const MoneyInput = forwardRef<HTMLInputElement, InputProps>(function MoneyInput(props, ref) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">
        ₹
      </span>
      <Input ref={ref} inputMode="decimal" autoComplete="off" className="pl-7" {...props} />
    </div>
  );
});
