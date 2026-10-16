import type { ReactNode } from 'react';
import { ErrorAlert } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  loading?: boolean;
  error?: string | null;
  onConfirm(): void;
  onClose(): void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  loading,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <div>{children}</div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
