import { apiFetchBlob } from './api';

/** A PDF the API renders: an invoice or a credit note. */
export interface PdfDocument {
  /** API path of the PDF, e.g. /sales/:id/invoice.pdf. */
  path: string;
  /** Document number, e.g. INV/26-27/00042; also names the file. */
  number: string;
  /** Shown to screen readers on the print frame, e.g. "Invoice". */
  kind: string;
}

const fileName = (d: PdfDocument) => `${d.number.replaceAll('/', '-')}.pdf`;

export const invoicePdf = (sale: { id: string; invoiceNumber: string }): PdfDocument => ({
  path: `/sales/${sale.id}/invoice.pdf`,
  number: sale.invoiceNumber,
  kind: 'Invoice',
});

export const creditNotePdf = (r: { id: string; returnNumber: string }): PdfDocument => ({
  path: `/returns/${r.id}/credit-note.pdf`,
  number: r.returnNumber,
  kind: 'Credit note',
});

/** Saves the PDF, e.g. "INV-26-27-00042.pdf". */
export async function downloadPdf(d: PdfDocument) {
  const url = URL.createObjectURL(await apiFetchBlob(d.path));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(d);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Opens the browser's print dialog for the PDF. It is loaded into a hidden frame (the request
 * needs the user's token, so a plain link would not work); if the browser cannot print a PDF
 * from a frame, it is downloaded instead.
 */
export async function printPdf(d: PdfDocument) {
  const blob = await apiFetchBlob(d.path);
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.title = `${d.kind} ${d.number}`;
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  const cleanUp = () =>
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName(d);
      link.click();
    }
    cleanUp();
  };
  document.body.append(frame);
}

export const downloadInvoice = (sale: { id: string; invoiceNumber: string }) =>
  downloadPdf(invoicePdf(sale));
export const printInvoice = (sale: { id: string; invoiceNumber: string }) =>
  printPdf(invoicePdf(sale));
