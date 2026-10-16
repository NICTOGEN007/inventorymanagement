import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

export interface ControlProps {
  id: string;
  invalid: boolean;
  'aria-describedby'?: string;
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  /**
   * The input or select. Pass the element directly, or a function that places the control
   * props on the real input when it is wrapped (e.g. with a show-password button).
   */
  children: ReactElement<Record<string, unknown>> | ((props: ControlProps) => ReactNode);
}

/** Label, control and error message, wired together for screen readers. */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const controlProps: ControlProps = {
    id,
    invalid: !!error,
    ...((error || hint) && { 'aria-describedby': messageId }),
  };
  const control =
    typeof children === 'function'
      ? children(controlProps)
      : isValidElement(children)
        ? cloneElement(children, { ...controlProps })
        : children;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {control}
      {error ? (
        <p id={messageId} className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : (
        hint && (
          <p id={messageId} className="text-xs text-slate-500 dark:text-slate-400">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
