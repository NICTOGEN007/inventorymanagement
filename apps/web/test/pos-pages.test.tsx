import type { CustomerSummaryDto, ProductDto, SaleDto, SaleList, SettingsDto } from '@ims/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { makeUser, mockApi, renderApp, session, type RecordedCall } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken(null);
  sessionStorage.clear();
});

const now = '2026-10-16T06:00:00.000Z';
const RICE = '64b000000000000000000101';
const SOAP = '64b000000000000000000102';
const SALE = '64b000000000000000000301';

const SETTINGS: SettingsDto = {
  shopName: 'Demo Mart',
  gstin: '29AABCS1234K1ZC',
  stateCode: '29',
  invoicePrefix: 'INV',
  purchaseOrderPrefix: 'PO',
  returnPrefix: 'RET',
};

const product = (id: string, name: string, overrides: Partial<ProductDto>): ProductDto => ({
  id,
  sku: `${name.slice(0, 3).toUpperCase()}-001`,
  name,
  category: { id: 'c', name: 'C' },
  unit: 'pcs',
  hsnCode: '1006',
  gstRate: 5,
  sellingPrice: 61700,
  taxInclusive: true,
  stock: 10,
  reorderLevel: 2,
  reorderQuantity: 10,
  stockStatus: 'ok',
  onOrder: 0,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const RICE_P = product(RICE, 'Basmati Rice 5 kg', { barcode: '8901234567890' });
const SOAP_P = product(SOAP, 'Bath Soap', {
  barcode: '8901111111111',
  hsnCode: '3401',
  gstRate: 18,
  sellingPrice: 18000,
  stock: 5,
});
const WESTERN: CustomerSummaryDto = {
  id: '64b000000000000000000401',
  name: 'Western Traders',
  phone: '9822012345',
  gstin: '27AAPFU0939F1ZV',
  stateCode: '27',
};

const sale = (overrides: Partial<SaleDto> = {}): SaleDto => ({
  id: SALE,
  invoiceNumber: 'INV/26-27/00042',
  soldAt: now,
  itemCount: 2,
  totalTax: 8614,
  grandTotal: 141400,
  status: 'completed',
  cashier: { id: 'cashier-id', name: 'Priya Nair' },
  placeOfSupply: '29',
  interState: false,
  items: [
    {
      product: { id: RICE, name: 'Basmati Rice 5 kg', sku: 'BAS-001', unit: 'pcs' },
      hsnCode: '1006',
      quantity: 2,
      unitPrice: 61700,
      taxInclusive: true,
      gstRate: 5,
      gross: 123400,
      discount: 0,
      taxable: 117524,
      cgst: 2938,
      sgst: 2938,
      igst: 0,
      total: 123400,
      returnedQuantity: 0,
      refunded: { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
    },
    {
      product: { id: SOAP, name: 'Bath Soap', sku: 'BAT-001', unit: 'pcs' },
      hsnCode: '3401',
      quantity: 1,
      unitPrice: 18000,
      taxInclusive: true,
      gstRate: 18,
      gross: 18000,
      discount: 50,
      taxable: 15212,
      cgst: 1369,
      sgst: 1369,
      igst: 0,
      total: 17950,
      returnedQuantity: 0,
      refunded: { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
    },
  ],
  gross: 141400,
  discount: 50,
  taxable: 132736,
  cgst: 4307,
  sgst: 4307,
  igst: 0,
  roundOff: 50,
  payments: [{ method: 'cash', amount: 141400 }],
  refundedTotal: 0,
  returns: [],
  ...overrides,
});

const lookup = ({ url }: RecordedCall) => {
  const code = new URL(url, 'http://x').searchParams.get('code');
  const match = [RICE_P, SOAP_P].find((p) => p.barcode === code);
  return match
    ? { body: { product: match } }
    : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'No match' } } };
};

const tillRoutes = (extra = {}) => ({
  'POST /api/auth/refresh': session(makeUser('cashier')),
  'GET /api/settings': { body: { settings: SETTINGS } },
  'GET /api/products/lookup': lookup,
  ...extra,
});

async function scan(code: string) {
  const input = await screen.findByRole('combobox', { name: 'Add product' });
  await userEvent.type(input, `${code}{Enter}`);
}
const totals = () => within(screen.getByLabelText('Bill totals'));
const salesBody = (calls: RecordedCall[]) =>
  calls.filter((c) => c.key === 'POST /api/sales').at(-1)?.body as Record<string, unknown>;

describe('Point of sale', () => {
  it('rings up scanned items with CGST + SGST, works out the change and bills them', async () => {
    const calls = mockApi(
      tillRoutes({ 'POST /api/sales': { status: 201, body: { sale: sale() } } }),
    );
    renderApp('/pos');
    await screen.findByRole('combobox', { name: 'Add product' });
    expect(screen.getByText(/start a bill/)).toBeInTheDocument();

    await scan('8901234567890');
    await scan('8901234567890'); // scanned twice: one more, not a second line
    await scan('8901111111111');
    expect(await screen.findByLabelText('Quantity of Basmati Rice 5 kg')).toHaveValue('2');
    expect(screen.getByLabelText('Quantity of Bath Soap')).toHaveValue('1');
    await userEvent.type(screen.getByLabelText('Discount on Bath Soap'), '0.50');

    // ₹1,234 rice + ₹179.50 soap = ₹1,413.50, rounded up to ₹1,414.
    expect(totals().getByText('Items (2)').nextSibling).toHaveTextContent('₹1,414.00');
    expect(totals().getByText('Discount').nextSibling).toHaveTextContent('−₹0.50');
    expect(totals().getByText('CGST').nextSibling).toHaveTextContent('₹43.07');
    expect(totals().getByText('SGST').nextSibling).toHaveTextContent('₹43.07');
    expect(totals().queryByText('IGST')).not.toBeInTheDocument();
    expect(totals().getByText('Round off').nextSibling).toHaveTextContent('+₹0.50');
    expect(totals().getByText('Total').nextSibling).toHaveTextContent('₹1,414.00');

    await userEvent.type(screen.getByLabelText('Cash received'), '1500');
    expect(screen.getByText('Change to return').nextSibling).toHaveTextContent('₹86.00');

    fireEvent.keyDown(window, { key: 'F9' });
    const dialog = await screen.findByRole('dialog', { name: 'Sale complete' });
    expect(dialog).toHaveTextContent('Invoice INV/26-27/00042');
    expect(dialog).toHaveTextContent('Change to return₹86.00');
    expect(salesBody(calls)).toMatchObject({
      items: [
        { product: RICE, quantity: 2, discount: 0 },
        { product: SOAP, quantity: 1, discount: 50 },
      ],
      payments: [{ method: 'cash', amount: 141400 }],
    });
    expect(salesBody(calls).clientRef).toEqual(expect.any(String));
    expect(salesBody(calls)).not.toHaveProperty('customer');

    await userEvent.click(within(dialog).getByRole('button', { name: 'New sale' }));
    expect(screen.getByText(/start a bill/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Bill totals')).toBeInTheDocument();
    expect(totals().getByText('Total').nextSibling).toHaveTextContent('₹0.00');
  });

  it('charges IGST for an out-of-state customer and takes a split payment', async () => {
    const calls = mockApi(
      tillRoutes({
        'GET /api/customers': { body: { data: [WESTERN], page: 1, pageSize: 8, total: 1 } },
        'POST /api/sales': { status: 201, body: { sale: sale({ interState: true }) } },
      }),
    );
    renderApp('/pos');
    await scan('8901234567890');
    await userEvent.type(screen.getByRole('combobox', { name: 'Find customer' }), 'west');
    await userEvent.click(await screen.findByRole('option', { name: /Western Traders/ }));
    expect(screen.getByText('Supply to another state: IGST applies.')).toBeInTheDocument();
    expect(totals().getByText('IGST').nextSibling).toHaveTextContent('₹29.38');
    expect(totals().queryByText('CGST')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Split' }));
    await userEvent.type(screen.getByLabelText('Cash amount'), '500');
    expect(screen.getByText('₹117.00 still to pay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Complete sale/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('UPI amount'), '117');
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));

    await screen.findByRole('dialog', { name: 'Sale complete' });
    expect(salesBody(calls)).toMatchObject({
      customer: WESTERN.id,
      payments: [
        { method: 'cash', amount: 50000 },
        { method: 'upi', amount: 11700 },
      ],
    });
  });

  it('checks stock and units before billing', async () => {
    mockApi(tillRoutes());
    renderApp('/pos');
    await scan('8901111111111');
    const qty = await screen.findByLabelText('Quantity of Bath Soap');
    await userEvent.clear(qty);
    await userEvent.type(qty, '6');
    expect(screen.getByRole('alert')).toHaveTextContent('Only 5 pcs in stock');
    await userEvent.clear(qty);
    await userEvent.type(qty, '1.5');
    expect(screen.getByRole('alert')).toHaveTextContent('Whole pcs only');
    expect(screen.getByRole('button', { name: /Complete sale/ })).toBeDisabled();
  });

  it('shows a stock error from the server on its line and refreshes that stock', async () => {
    mockApi(
      tillRoutes({
        'POST /api/sales': {
          status: 409,
          body: {
            error: {
              code: 'INSUFFICIENT_STOCK',
              message: 'Only 1 pcs of Basmati Rice 5 kg in stock',
              details: [
                {
                  path: ['items', 0, 'quantity'],
                  message: 'Only 1 pcs of Basmati Rice 5 kg in stock',
                },
              ],
            },
          },
        },
        [`GET /api/products/${RICE}`]: { body: { product: { ...RICE_P, stock: 1 } } },
      }),
    );
    renderApp('/pos');
    await scan('8901234567890');
    await scan('8901234567890');
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only 1 pcs of Basmati Rice 5 kg in stock',
    );
    expect(await screen.findByText(/1 pcs in stock/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Complete sale/ })).toBeDisabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the open bill after a page reload', async () => {
    mockApi(tillRoutes());
    const { unmount } = renderApp('/pos');
    await scan('8901111111111');
    await screen.findByLabelText('Quantity of Bath Soap');
    unmount();
    renderApp('/pos');
    expect(await screen.findByLabelText('Quantity of Bath Soap')).toHaveValue('1');
    await userEvent.click(screen.getByRole('button', { name: 'Clear bill' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Clear this bill?' })).getByRole('button', {
        name: 'Clear bill',
      }),
    );
    expect(screen.getByText(/start a bill/)).toBeInTheDocument();
  });
});

describe('Sales history', () => {
  const list = (data: SaleDto[]): { body: SaleList } => ({
    body: {
      data: data.map(({ items, payments, ...s }) => ({
        ...s,
        itemCount: items.length,
        paymentMethods: payments.map((p) => p.method),
      })) as unknown as SaleList['data'],
      page: 1,
      pageSize: 20,
      total: data.length,
      summary: { count: data.length, total: data.reduce((a, s) => a + s.grandTotal, 0) },
    },
  });

  it('lists bills with a summary and filters by period and payment through the URL', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      'GET /api/sales': list([
        sale(),
        sale({
          id: '64b000000000000000000302',
          invoiceNumber: 'INV/26-27/00043',
          customer: { name: 'Western Traders' },
          grandTotal: 61700,
          payments: [
            { method: 'cash', amount: 30000 },
            { method: 'upi', amount: 31700 },
          ],
        }),
      ]),
    });
    renderApp('/pos/sales');
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('INV/26-27/00042');
    expect(rows[1]).toHaveTextContent('Walk-in customer');
    expect(rows[2]).toHaveTextContent('Western Traders');
    expect(rows[2]).toHaveTextContent('Cash + UPI');
    expect(screen.getByText('₹2,031.00')).toBeInTheDocument();
    expect(screen.getByText('2 bills · average ₹1,015.50')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() =>
      expect(calls.at(-1)?.url).toMatch(/^\/api\/sales\?from=\d{4}-\d\d-\d\d&to=/),
    );
    await userEvent.selectOptions(screen.getByLabelText('Payment method'), 'upi');
    await waitFor(() => expect(calls.at(-1)?.url).toContain('method=upi'));
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a sale with its tax and downloads the invoice PDF', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      [`GET /api/sales/${SALE}`]: { body: { sale: sale() } },
      [`GET /api/sales/${SALE}/invoice.pdf`]: { body: {} },
    });
    const createObjectURL = vi.fn(() => 'blob:invoice');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderApp(`/pos/sales/${SALE}`);
    expect(await screen.findByRole('heading', { name: 'INV/26-27/00042' })).toBeInTheDocument();
    expect(screen.getByText('Within the state: CGST + SGST')).toBeInTheDocument();
    expect(screen.getByText('Rupees One Thousand Four Hundred Fourteen Only')).toBeInTheDocument();
    const invoiceTotals = within(screen.getByLabelText('Invoice totals'));
    expect(invoiceTotals.getByText('CGST').nextSibling).toHaveTextContent('₹43.07');
    expect(invoiceTotals.getByText('Round off').nextSibling).toHaveTextContent('+₹0.50');

    await act(() => userEvent.click(screen.getByRole('button', { name: 'Download PDF' })));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(calls.some((c) => c.url === `/api/sales/${SALE}/invoice.pdf`)).toBe(true);
    expect(createObjectURL).toHaveBeenCalled();
  });
});
