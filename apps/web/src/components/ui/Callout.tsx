import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const TONES = {
  info: 'border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10',
  warning: 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10',
  success: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
} as const;

/**
 * A tinted note box. (A Card's own white background would win over a tint passed to it, since
 * class names are joined, not merged.)
 */
export function Callout({
  tone,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone: keyof typeof TONES }) {
  return <div className={cn('rounded-xl border p-4 text-sm', TONES[tone], className)} {...props} />;
}
