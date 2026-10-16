import type {
  CustomerDto,
  CustomerListItemDto,
  SaleDto,
  SaleReturnDto,
  SaleReturnList,
  SettingsDto,
} from '@ims/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
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
const RETURN = '64b000000000000000000501';
const CUSTOMER = '64b000000000000000000401';
const none = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };

const SETTINGS: SettingsDto = {
  shopName: 'Demo Mart',
  gstin: '29AABCS1234K1ZC',
  stateCode: '29',
  invoicePrefix: 'INV',
  purchaseOrderPrefix: 'PO',
  returnPrefix: 'RET',
};

/** 2 rice at ₹617 and 1 soap at ₹179.50: ₹1,413.50, billed ₹1,414. */
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
      refunded: none,
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
      refunded: none,
    },
  ],
  gross: 141400,
  discount: 50,
  taxable: 132736,
  cgst: 4307,
  sgst: 4307,
  igst: 0,
  roundOff: 50,
  payments: [{ method: 'upi', amount: 141400 }],
  refundedTotal: 0,
  returns: [],
  ...overrides,
});

/** One rice already came back for ₹617. */
const partlyReturned = () => {
  const s = sale({ status: 'partially_returned', refundedTotal: 61700 });
  s.items[0] = {
    ...s.items[0]!,
    returnedQuantity: 1,
    refunded: { taxable: 58762, cgst: 1469, sgst: 1469, igst: 0 },
  };
  s.returns = [
    { id: RETURN, returnNumber: 'RET/26-27/00007', returnedAt: now, totalRefund: 61700 },
  ];
  return s;
};

const creditNote = (overrides: Partial<SaleReturnDto> = {}): SaleReturnDto => ({
  id: RETURN,
  returnNumber: 'RET/26-27/00008',
  returnedAt: now,
  sale: { id: SALE, invoiceNumber: 'INV/26-27/00042' },
  itemCount: 1,
  totalRefund: 61700,
  refundMethod: 'upi',
  reason: 'Damaged or defective',
  processedBy: { id: 'cashier-id', name: 'Priya Nair' },
  soldAt: now,
  placeOfSupply: '29',
  interState: false,
  items: [
    {
      product: { id: RICE, name: 'Basmati Rice 5 kg', sku: 'BAS-001', unit: 'pcs' },
      hsnCode: '1006',
      gstRate: 5,
      quantity: 1,
      taxable: 58762,
      cgst: 1469,
      sgst: 1469,
      igst: 0,
      total: 61700,
      restock: false,
    },
  ],
  taxable: 58762,
  cgst: 1469,
  sgst: 1469,
  igst: 0,
  totalTax: 2938,
  roundOff: 0,
  ...overrides,
});

const returnBody = (calls: RecordedCall[]) =>
  calls.find((c) => c.key === 'POST /api/returns')?.body as Record<string, unknown>;
const refund = () => within(screen.getByLabelText('Refund totals'));

describe('Returns', () => {
  it('takes back what is left of a line, keeps damaged goods off the shelf and opens the credit note', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      [`GET /api/sales/${SALE}`]: { body: { sale: partlyReturned() } },
      'POST /api/returns': { status: 201, body: { saleReturn: creditNote() } },
      [`GET /api/returns/${RETURN}`]: { body: { saleReturn: creditNote() } },
    });
    renderApp(`/pos/sales/${SALE}/return`);
    expect(await screen.findByRole('heading', { name: 'Return items' })).toBeInTheDocument();
    expect(screen.getByText(/1 pcs returned/)).toBeInTheDocument();

    const rice = screen.getByLabelText('Quantity of Basmati Rice 5 kg to return');
    await userEvent.type(rice, '2');
    expect(screen.getByText('Only 1 pcs can be returned')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check the quantities' })).toBeDisabled();

    await userEvent.clear(rice);
    await userEvent.type(rice, '1');
    // The second rice refunds exactly what is left of the line.
    expect(refund().getByText('Taxable value').nextSibling).toHaveTextContent('₹587.62');
    expect(refund().getByText('CGST').nextSibling).toHaveTextContent('₹14.69');
    expect(refund().getByText('To refund').nextSibling).toHaveTextContent('₹617.00');

    const row = screen.getByText('Basmati Rice 5 kg').closest('tr')!;
    await userEvent.click(within(row).getByLabelText('Back to stock'));
    // Refund goes back the way the customer paid.
    expect(screen.getByRole('button', { name: 'UPI' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Refund ₹617.00' }));
    expect(await screen.findByText('Give a short reason')).toBeInTheDocument();
    expect(returnBody(calls)).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: 'Damaged or defective' }));
    await userEvent.click(screen.getByRole('button', { name: 'Refund ₹617.00' }));
    expect(await screen.findByRole('heading', { name: 'RET/26-27/00008' })).toBeInTheDocument();
    expect(returnBody(calls)).toMatchObject({
      sale: SALE,
      items: [{ product: RICE, quantity: 1, restock: false }],
      refundMethod: 'upi',
      reason: 'Damaged or defective',
      clientRef: expect.any(String),
    });
    expect(screen.getByText('Not restocked')).toBeInTheDocument();
    const totals = within(screen.getByLabelText('Credit note totals'));
    expect(totals.getByText('Refund').nextSibling).toHaveTextContent('₹617.00');
  });

  it('refunds the whole bill, round-off included, when everything comes back', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      [`GET /api/sales/${SALE}`]: { body: { sale: sale() } },
    });
    renderApp(`/pos/sales/${SALE}/return`);
    await userEvent.click(await screen.findByRole('button', { name: 'Return everything' }));
    expect(screen.getByLabelText('Quantity of Bath Soap to return')).toHaveValue('1');
    expect(refund().getByText('Round off').nextSibling).toHaveTextContent('+₹0.50');
    expect(refund().getByText('To refund').nextSibling).toHaveTextContent('₹1,414.00');
  });

  it('shows a line error from the server next to its item', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      [`GET /api/sales/${SALE}`]: { body: { sale: sale() } },
      'POST /api/returns': {
        status: 400,
        body: {
          error: {
            code: 'BAD_REQUEST',
            message: 'Bath Soap was already returned',
            details: [
              { path: ['items', 0, 'quantity'], message: 'Bath Soap was already returned' },
            ],
          },
        },
      },
    });
    renderApp(`/pos/sales/${SALE}/return`);
    await userEvent.type(await screen.findByLabelText('Quantity of Bath Soap to return'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Wrong item' }));
    await userEvent.click(screen.getByRole('button', { name: /Refund ₹/ }));
    const row = screen.getByText('Bath Soap').closest('tr')!;
    expect(await within(row).findByText('Bath Soap was already returned')).toBeInTheDocument();
  });

  it('lists credit notes and finds the bill to start a new return', async () => {
    const list: SaleReturnList = {
      data: [creditNote({ customer: { id: CUSTOMER, name: 'Asha Rao' } })],
      page: 1,
      pageSize: 20,
      total: 1,
      summary: { count: 1, total: 61700 },
    };
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      'GET /api/returns': { body: list },
      'GET /api/sales': {
        body: {
          data: [{ ...sale(), paymentMethods: ['upi'] }],
          page: 1,
          pageSize: 6,
          total: 1,
          summary: { count: 1, total: 141400 },
        },
      },
      [`GET /api/sales/${SALE}`]: { body: { sale: sale() } },
    });
    renderApp('/pos/returns');
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('RET/26-27/00008');
    expect(rows[1]).toHaveTextContent('INV/26-27/00042 · Asha Rao');
    expect(rows[1]).toHaveTextContent('₹617.00');
    expect(screen.getByText('1 return')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New return' }));
    const dialog = screen.getByRole('dialog', { name: 'Return items' });
    await userEvent.type(within(dialog).getByLabelText('Find the bill'), '42');
    await userEvent.click(await within(dialog).findByRole('link', { name: /INV\/26-27\/00042/ }));
    expect(await screen.findByRole('heading', { name: 'Return items' })).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith('/api/sales?search=42'))).toBe(true);
  });

  it('shows the returns on the original sale and offers to return the rest', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      [`GET /api/sales/${SALE}`]: { body: { sale: partlyReturned() } },
    });
    renderApp(`/pos/sales/${SALE}`);
    expect(await screen.findByText('Partly returned')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'RET/26-27/00007' })).toBeInTheDocument();
    expect(screen.getByText('Net after ₹617.00 refunded').nextSibling).toHaveTextContent('₹797.00');
    expect(screen.getByRole('link', { name: 'Return items' })).toHaveAttribute(
      'href',
      `/pos/sales/${SALE}/return`,
    );
  });

  it('downloads the credit note PDF', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      [`GET /api/returns/${RETURN}`]: { body: { saleReturn: creditNote() } },
      [`GET /api/returns/${RETURN}/credit-note.pdf`]: { body: {} },
    });
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderApp(`/pos/returns/${RETURN}`);
    const download = await screen.findByRole('button', { name: 'Download PDF' });
    await act(() => userEvent.click(download));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(calls.some((c) => c.url === `/api/returns/${RETURN}/credit-note.pdf`)).toBe(true);
  });
});

const listItem = (overrides: Partial<CustomerListItemDto> = {}): CustomerListItemDto => ({
  id: CUSTOMER,
  name: 'Asha Rao',
  phone: '9845012345',
  isActive: true,
  createdAt: now,
  stats: { visits: 12, totalSpent: 845000, lastPurchaseAt: now },
  ...overrides,
});

const customer = (overrides: Partial<CustomerDto> = {}): CustomerDto => ({
  ...listItem(),
  updatedAt: now,
  address: { city: 'Bengaluru', pincode: '560038' },
  stats: {
    visits: 12,
    totalSpent: 845000,
    lastPurchaseAt: now,
    firstPurchaseAt: '2025-11-02T06:00:00.000Z',
    averageBill: 70417,
    returns: 1,
    refunded: 61700,
  },
  topProducts: [
    {
      product: { id: RICE, name: 'Basmati Rice 5 kg', unit: 'pcs' },
      quantity: 9,
      total: 555300,
    },
  ],
  ...overrides,
});

describe('Customers', () => {
  it('lists customers with what they spent and adds a new one', async () => {
    const created = customer({
      id: '64b000000000000000000402',
      name: 'Hosur Mini Mart',
      gstin: '33AABCH1234K1ZY',
      stateCode: '33',
      stats: { ...customer().stats, visits: 0, totalSpent: 0, returns: 0, refunded: 0 },
      topProducts: [],
    });
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/settings': { body: { settings: SETTINGS } },
      'GET /api/customers': {
        body: {
          data: [listItem(), listItem({ id: 'x', name: 'Ravi Kumar', isActive: false })],
          page: 1,
          pageSize: 20,
          total: 2,
        },
      },
      'POST /api/customers': { status: 201, body: { customer: created } },
      [`GET /api/customers/${created.id}`]: { body: { customer: created } },
      'GET /api/sales': {
        body: { data: [], page: 1, pageSize: 10, total: 0, summary: { count: 0, total: 0 } },
      },
    });
    renderApp('/customers');
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Asha Rao');
    expect(rows[1]).toHaveTextContent('₹8,450.00');
    expect(rows[2]).toHaveTextContent('Inactive');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'all');
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/customers?status=all'));

    await userEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    const dialog = screen.getByRole('dialog', { name: 'Add customer' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Hosur Mini Mart');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), '33AABCH1234K1ZY');
    // The GSTIN fills in the state.
    expect(within(dialog).getByLabelText('State')).toHaveValue('33');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add customer' }));
    expect(await screen.findByRole('heading', { name: 'Hosur Mini Mart' })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/customers')?.body).toMatchObject({
      name: 'Hosur Mini Mart',
      gstin: '33AABCH1234K1ZY',
      stateCode: '33',
    });
    expect(screen.getByText('Other state: bills carry IGST')).toBeInTheDocument();
    // Never billed, so it can still be deleted.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('shows a customer’s spending, favourite products and bills', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      'GET /api/settings': { body: { settings: SETTINGS } },
      [`GET /api/customers/${CUSTOMER}`]: { body: { customer: customer() } },
      'GET /api/sales': {
        body: {
          data: [
            {
              ...partlyReturned(),
              customer: { id: CUSTOMER, name: 'Asha Rao' },
              paymentMethods: ['upi'],
            },
          ],
          page: 1,
          pageSize: 10,
          total: 1,
          summary: { count: 1, total: 141400 },
        },
      },
      'GET /api/returns': {
        body: {
          data: [creditNote()],
          page: 1,
          pageSize: 5,
          total: 1,
          summary: { count: 1, total: 61700 },
        },
      },
    });
    renderApp(`/customers/${CUSTOMER}`);
    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('₹8,450.00')).toBeInTheDocument();
    expect(screen.getByText('after ₹617.00 refunded')).toBeInTheDocument();
    expect(screen.getByText('average ₹704.17')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Basmati Rice 5 kg' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'INV/26-27/00042' })).toBeInTheDocument();
    expect(screen.getByText('Partly returned')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'RET/26-27/00008' })).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith(`/api/sales?customer=${CUSTOMER}`))).toBe(true);
    // Has bills: edit, but no delete.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('registers a new customer from the till and puts them on the bill', async () => {
    const created = customer({
      id: '64b000000000000000000402',
      name: 'Hosur Mini Mart',
      phone: '9443012345',
      gstin: '33AABCH1234K1ZY',
      stateCode: '33',
    });
    mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      'GET /api/settings': { body: { settings: SETTINGS } },
      'POST /api/customers': { status: 201, body: { customer: created } },
    });
    renderApp('/pos');
    await userEvent.click(await screen.findByRole('button', { name: 'New customer' }));
    const dialog = screen.getByRole('dialog', { name: 'Add customer' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Hosur Mini Mart');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add customer' }));
    expect(await screen.findByText('Supply to another state: IGST applies.')).toBeInTheDocument();
    expect(screen.getByText('Hosur Mini Mart')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
