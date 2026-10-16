import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-xs placeholder:text-slate-400',
        'focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none dark:bg-slate-900 dark:text-slate-100',
        invalid ? 'border-rose-500' : 'border-slate-300 dark:border-slate-700',
        className,
      )}
      {...props}
    />
  );
});
