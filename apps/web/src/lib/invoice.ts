import { apiFetchBlob } from './api';

interface InvoiceRef {
  id: string;
  invoiceNumber: string;
}

const fileName = (sale: InvoiceRef) => `${sale.invoiceNumber.replaceAll('/', '-')}.pdf`;

/** Saves the GST invoice PDF, e.g. "INV-26-27-00042.pdf". */
export async function downloadInvoice(sale: InvoiceRef) {
  const url = URL.createObjectURL(await apiFetchBlob(`/sales/${sale.id}/invoice.pdf`));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(sale);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Opens the browser's print dialog for the invoice. The PDF is loaded into a hidden frame
 * (the request needs the user's token, so a plain link would not work); if the browser
 * cannot print a PDF from a frame, it is downloaded instead.
 */
export async function printInvoice(sale: InvoiceRef) {
  const blob = await apiFetchBlob(`/sales/${sale.id}/invoice.pdf`);
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.title = `Invoice ${sale.invoiceNumber}`;
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
      link.download = fileName(sale);
      link.click();
    }
    cleanUp();
  };
  document.body.append(frame);
}
