import { useState } from 'react';
import { downloadPdf, printPdf, type PdfDocument } from './invoice';

/** Print and download for one PDF, with which action is running and what went wrong. */
export function usePdfActions(document: PdfDocument | undefined) {
  const [busy, setBusy] = useState<'print' | 'download' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: 'print' | 'download') => {
    if (!document) return;
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'print' ? printPdf(document) : downloadPdf(document));
    } catch (err) {
      setError(`Could not get the ${document.kind.toLowerCase()}. ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return { busy, error, run, clearError: () => setError(null) };
}
