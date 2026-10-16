import type { ProductDto, PurchaseOrderDto, SettingsDto, SupplierDto } from '@ims/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { makeUser, mockApi, renderApp, session } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

const now = '2026-10-16T06:00:00.000Z';
const LOCAL = '64b000000000000000000201';
const PUNE = '64b000000000000000000202';
const RICE = '64b000000000000000000101';
const SOAP = '64b000000000000000000102';
const OIL = '64b000000000000000000103';

const SETTINGS: SettingsDto = {
  shopName: 'Demo Mart',
  gstin: '29AABCS1234K1ZC',
  stateCode: '29',
  invoicePrefix: 'INV',
  purchaseOrderPrefix: 'PO',
  returnPrefix: 'RET',
};
const supplier = (
  id: string,
  name: string,
  stateCode: '29' | '27',
  leadTimeDays: number,
): SupplierDto => ({
  id,
  name,
  stateCode,
  leadTimeDays,
  isActive: true,
  productCount: 2,
  createdAt: now,
  updatedAt: now,
});
const SUPPLIERS = [
  supplier(LOCAL, 'Karnataka Agro', '29', 3),
  supplier(PUNE, 'Western FMCG', '27', 6),
];

const product = (id: string, name: string, overrides: Partial<ProductDto> = {}): ProductDto => ({
  id,
  sku: name.slice(0, 3).toUpperCase() + '-001',
  name,
  category: { id: 'c', name: 'C' },
  unit: 'pcs',
  hsnCode: '1006',
  gstRate: 18,
  costPrice: 10000,
  sellingPrice: 15000,
  taxInclusive: true,
  stock: 2,
  reorderLevel: 10,
  reorderQuantity: 24,
  stockStatus: 'low',
  onOrder: 0,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const page = <T,>(data: T[]) => ({ body: { data, page: 1, pageSize: 20, total: data.length } });

const base = {
  'POST /api/auth/refresh': session(makeUser('manager')),
  'GET /api/settings': { body: { settings: SETTINGS } },
  'GET /api/suppliers': { body: { data: SUPPLIERS } },
};

const ORDER: PurchaseOrderDto = {
  id: '64b000000000000000000301',
  poNumber: 'PO/26-27/00012',
  supplier: { id: LOCAL, name: 'Karnataka Agro' },
  supplierDetails: { name: 'Karnataka Agro', stateCode: '29', leadTimeDays: 3 },
  status: 'partially_received',
  interState: false,
  itemCount: 2,
  taxable: 300000,
  cgst: 7500,
  sgst: 7500,
  igst: 0,
  total: 315000,
  orderedAt: now,
  expectedAt: now,
  overdue: false,
  createdAt: now,
  items: [
    {
      product: { id: RICE, name: 'Rice', sku: 'STP-001', unit: 'pcs' },
      quantity: 10,
      receivedQuantity: 6,
      remainingQuantity: 4,
      unitCost: 25000,
      gstRate: 5,
      taxable: 250000,
      cgst: 6250,
      sgst: 6250,
      igst: 0,
      total: 262500,
    },
    {
      product: { id: OIL, name: 'Oil', sku: 'STP-006', unit: 'pcs' },
      quantity: 5,
      receivedQuantity: 0,
      remainingQuantity: 5,
      unitCost: 10000,
      gstRate: 5,
      taxable: 50000,
      cgst: 1250,
      sgst: 1250,
      igst: 0,
      total: 52500,
    },
  ],
  receipts: [
    {
      receivedAt: now,
      supplierInvoiceNumber: 'SI-1',
      items: [{ product: { id: RICE, name: 'Rice' }, quantity: 6 }],
    },
  ],
};

describe('New purchase order', () => {
  it('charges IGST for an out-of-state supplier and places the order with paise amounts', async () => {
    const calls = mockApi({
      ...base,
      'GET /api/products': page([product(SOAP, 'Bath Soap')]),
      'POST /api/purchase-orders': {
        status: 201,
        body: { purchaseOrder: { ...ORDER, status: 'ordered', poNumber: 'PO/26-27/00013' } },
      },
      [`GET /api/purchase-orders/${ORDER.id}`]: { body: { purchaseOrder: ORDER } },
    });
    renderApp('/purchases/new');
    await screen.findByRole('option', { name: 'Western FMCG' });
    await userEvent.selectOptions(screen.getByLabelText('Supplier'), 'Western FMCG');
    expect(screen.getByText(/IGST \(another state\)/)).toBeInTheDocument();

    await userEvent.type(screen.getByRole('combobox', { name: 'Find product' }), 'soap');
    await userEvent.click(await screen.findByRole('option', { name: /Bath Soap/ }));
    expect(screen.getByLabelText('Cost per unit of Bath Soap')).toHaveValue('100'); // prefilled from cost price
    await userEvent.type(screen.getByLabelText('Quantity of Bath Soap'), '12');

    const totals = screen.getByLabelText('Order totals');
    expect(totals).toHaveTextContent('Before GST₹1,200.00');
    expect(totals).toHaveTextContent('IGST₹216.00');
    expect(totals).toHaveTextContent('Total₹1,416.00');

    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /api/purchase-orders')?.body).toEqual({
        supplier: PUNE,
        items: [{ product: SOAP, quantity: 12, unitCost: 10000 }],
        notes: '',
        place: true,
      }),
    );
  });

  it('adds this supplier’s low-stock items that are not already on order', async () => {
    const calls = mockApi({
      ...base,
      'GET /api/products': ({ url }) =>
        page(
          url.includes('stock=out')
            ? [
                product(OIL, 'Sunflower Oil', {
                  stock: 0,
                  stockStatus: 'out',
                  reorderQuantity: 144,
                  costPrice: 14000,
                  gstRate: 5,
                }),
              ]
            : [
                product(RICE, 'Basmati Rice', { reorderQuantity: 66 }),
                product(SOAP, 'Already Ordered', { onOrder: 24 }),
              ],
        ),
      'POST /api/purchase-orders': {
        status: 201,
        body: { purchaseOrder: { ...ORDER, status: 'draft' } },
      },
      [`GET /api/purchase-orders/${ORDER.id}`]: { body: { purchaseOrder: ORDER } },
    });
    renderApp('/purchases/new');
    await screen.findByRole('option', { name: 'Karnataka Agro' });
    await userEvent.selectOptions(screen.getByLabelText('Supplier'), 'Karnataka Agro');
    await userEvent.click(screen.getByRole('button', { name: 'Add low-stock items' }));
    expect(await screen.findByLabelText('Quantity of Sunflower Oil')).toHaveValue('144');
    expect(screen.getByLabelText('Quantity of Basmati Rice')).toHaveValue('66');
    expect(screen.queryByLabelText('Quantity of Already Ordered')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.key === 'GET /api/products').map((c) => c.url)).toContain(
      `/api/products?supplier=${LOCAL}&stock=low&pageSize=100`,
    );
    expect(screen.getByLabelText('Order totals')).toHaveTextContent('CGST + SGST');

    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(
        (calls.find((c) => c.key === 'POST /api/purchase-orders')?.body as { place: boolean })
          .place,
      ).toBe(false),
    );
  });

  it('checks the order before sending', async () => {
    const calls = mockApi({ ...base, 'GET /api/products': page([product(RICE, 'Rice')]) });
    renderApp('/purchases/new');
    await screen.findByRole('option', { name: 'Karnataka Agro' });
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(screen.getByText('Choose a supplier')).toBeInTheDocument();
    expect(screen.getByText('Add at least one product')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Supplier'), 'Karnataka Agro');
    await userEvent.type(screen.getByRole('combobox', { name: 'Find product' }), 'ric');
    await userEvent.click(await screen.findByRole('option', { name: /Rice/ }));
    await userEvent.type(screen.getByLabelText('Quantity of Rice'), '2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('Whole pcs only')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/purchase-orders')).toBe(false);
  });
});

describe('Purchase order page', () => {
  const routes = (extra = {}) => ({
    ...base,
    [`GET /api/purchase-orders/${ORDER.id}`]: { body: { purchaseOrder: ORDER } },
    ...extra,
  });

  it('shows what has arrived and what is still to come', async () => {
    mockApi(routes());
    renderApp(`/purchases/${ORDER.id}`);
    expect(await screen.findByRole('heading', { name: 'PO/26-27/00012' })).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('6 pcs');
    expect(rows[1]).toHaveTextContent('4 pcs to come');
    expect(screen.getByText('Partly received')).toBeInTheDocument();
    expect(screen.getByText(/bill SI-1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close order' })).toBeInTheDocument(); // partly received: close, not cancel
  });

  it('receives a delivery, defaulting to what is outstanding', async () => {
    const calls = mockApi(
      routes({
        [`POST /api/purchase-orders/${ORDER.id}/receive`]: {
          body: { purchaseOrder: { ...ORDER, status: 'received' } },
        },
      }),
    );
    renderApp(`/purchases/${ORDER.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Received quantity of Rice')).toHaveValue('4');
    await userEvent.clear(within(dialog).getByLabelText('Received quantity of Oil'));
    await userEvent.type(within(dialog).getByLabelText('Received quantity of Oil'), '3');
    await userEvent.type(
      within(dialog).getByLabelText("Supplier's bill number (optional)"),
      'SI-2',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to stock' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key.endsWith('/receive'))?.body).toEqual({
        items: [
          { product: RICE, quantity: 4 },
          { product: OIL, quantity: 3 },
        ],
        supplierInvoiceNumber: 'SI-2',
        note: '',
      }),
    );
  });

  it('will not receive more than is outstanding', async () => {
    const calls = mockApi(routes());
    renderApp(`/purchases/${ORDER.id}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Received quantity of Rice'));
    await userEvent.type(within(dialog).getByLabelText('Received quantity of Rice'), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add to stock' }));
    expect(within(dialog).getByText('At most 4')).toBeInTheDocument();
    expect(calls.some((c) => c.key.endsWith('/receive'))).toBe(false);
  });
});

describe('Purchases list', () => {
  it('filters by status through the URL', async () => {
    const calls = mockApi({ ...base, 'GET /api/purchase-orders': page([ORDER]) });
    renderApp('/purchases');
    expect(await screen.findByRole('link', { name: 'PO/26-27/00012' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Awaiting delivery' }));
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/purchase-orders?status=open'));
    expect(screen.getByRole('button', { name: 'Awaiting delivery' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('is hidden from cashiers', async () => {
    mockApi({ ...base, 'POST /api/auth/refresh': session(makeUser('cashier')) });
    renderApp('/purchases');
    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page" }),
    ).toBeInTheDocument();
  });
});
