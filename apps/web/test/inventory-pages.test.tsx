import type { InventorySummary, ProductDto, StockMovementDto } from '@ims/shared';
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
const RICE_ID = '64b000000000000000000101';
const SUGAR_ID = '64b000000000000000000102';

const product = (overrides: Partial<ProductDto>): ProductDto => ({
  id: RICE_ID,
  sku: 'STP-001',
  name: 'Basmati Rice 5 kg',
  category: { id: '64b000000000000000000001', name: 'Staples' },
  unit: 'pcs',
  hsnCode: '1006',
  gstRate: 5,
  costPrice: 50000,
  sellingPrice: 61700,
  taxInclusive: true,
  stock: 10,
  reorderLevel: 33,
  reorderQuantity: 66,
  packSize: 1,
  stockStatus: 'low',
  onOrder: 0,
  isActive: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const RICE = product({});
const SUGAR = product({
  id: SUGAR_ID,
  sku: 'STP-004',
  name: 'Sugar (loose)',
  unit: 'kg',
  stock: 2.5,
  costPrice: 4200,
});
const page = <T,>(data: T[]) => ({ body: { data, page: 1, pageSize: 25, total: data.length } });

const SUMMARY: InventorySummary = {
  costValue: 234567800,
  retailValue: 287654300,
  products: 44,
  lowStock: 13,
  outOfStock: 3,
  byCategory: [
    {
      category: { id: 'c1', name: 'Staples & Grains' },
      costValue: 120000000,
      retailValue: 140000000,
      products: 10,
      lowStock: 3,
      outOfStock: 1,
    },
    {
      category: { id: 'c2', name: 'Dairy' },
      costValue: 30000000,
      retailValue: 33000000,
      products: 5,
      lowStock: 1,
      outOfStock: 0,
    },
  ],
  writeOffs30d: {
    value: 350000,
    byReason: [
      { reason: 'damaged', value: 250000 },
      { reason: 'expired', value: 100000 },
    ],
  },
};

describe('Inventory overview', () => {
  it('shows stock value, write-offs and what needs attention to managers', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/inventory/summary': { body: SUMMARY },
      'GET /api/products': ({ url }) =>
        page(
          url.includes('stock=out')
            ? [product({ id: 'x', name: 'Sunflower Oil', stock: 0, stockStatus: 'out' })]
            : [RICE],
        ),
    });
    renderApp('/inventory');
    expect(await screen.findByText('₹23.5L')).toBeInTheDocument(); // value at cost, in lakh
    expect(screen.getByText('Damaged ₹2,500 · Expired ₹1,000')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Staples & Grains');
    const attention = await screen.findByRole('heading', { name: 'Needs attention' });
    const list = attention.closest('div')!.parentElement!;
    expect(within(list).getByText('Sunflower Oil')).toBeInTheDocument();
    expect(within(list).getAllByText('Not ordered')).toHaveLength(2);
  });

  it('shows cashiers what is low without any money figures', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      'GET /api/products': ({ url }) => page(url.includes('stock=low') ? [RICE] : []),
    });
    renderApp('/inventory');
    expect(await screen.findByText('Basmati Rice 5 kg')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'GET /api/inventory/summary')).toBe(false);
    expect(screen.queryByText('Stock value at cost')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Adjust stock' })).not.toBeInTheDocument();
  });
});

describe('Stock history', () => {
  const movement = (overrides: Partial<StockMovementDto>): StockMovementDto => ({
    id: 'm1',
    product: { id: RICE_ID, name: 'Basmati Rice 5 kg', sku: 'STP-001', unit: 'pcs' },
    type: 'sale',
    quantity: -2,
    balanceAfter: 10,
    value: -100000,
    reference: { kind: 'Sale', id: 's1', number: 'INV/26-27/00042' },
    createdBy: { id: 'u', name: 'Priya Nair' },
    occurredAt: now,
    ...overrides,
  });

  it('lists changes with sign, balance, document number and value', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/inventory/movements': page([
        movement({}),
        movement({
          id: 'm2',
          type: 'adjustment',
          reason: 'expired',
          quantity: -1,
          balanceAfter: 12,
          reference: undefined,
          note: 'Past date',
        }),
      ]),
    });
    renderApp('/inventory/movements');
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('−2 pcs');
    expect(rows[1]).toHaveTextContent('INV/26-27/00042');
    expect(rows[1]).toHaveTextContent('-₹1,000.00');
    expect(rows[2]).toHaveTextContent('Expired');
    expect(rows[2]).toHaveTextContent('Past date');
  });

  it('filters by type and date through the URL', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/inventory/movements': page([movement({})]),
    });
    renderApp('/inventory/movements');
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Type of change'), 'adjustment');
    await userEvent.type(screen.getByLabelText('From'), '2026-10-01');
    await waitFor(() =>
      expect(calls.at(-1)?.url).toBe('/api/inventory/movements?type=adjustment&from=2026-10-01'),
    );
  });
});

describe('Adjust stock', () => {
  const routes = (extra = {}) => ({
    'POST /api/auth/refresh': session(makeUser('manager')),
    'GET /api/products': ({ url }: { url: string }) =>
      page(url.includes('search=sug') ? [SUGAR] : [RICE]),
    ...extra,
  });

  async function pick(name: string, search: string) {
    await userEvent.type(await screen.findByRole('combobox'), search);
    await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
  }

  it('records a stock count as the counted quantity and shows the result', async () => {
    const calls = mockApi(
      routes({
        'POST /api/inventory/adjustments': {
          status: 201,
          body: {
            adjusted: [
              {
                product: { id: RICE_ID, name: 'Basmati Rice 5 kg' },
                before: 10,
                after: 8,
                change: -2,
              },
            ],
            unchanged: [],
          },
        },
      }),
    );
    renderApp('/inventory/adjust');
    await pick('Basmati Rice', 'ric');
    await userEvent.type(screen.getByLabelText('Counted for Basmati Rice 5 kg'), '8');
    const row = screen.getByRole('row', { name: /Basmati Rice/ });
    expect(row).toHaveTextContent('8 pcs');
    expect(row).toHaveTextContent('−2 pcs');
    expect(screen.getByText(/value change at cost -₹1,000.00/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Review adjustment' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply adjustment' }),
    );
    expect(await screen.findByRole('heading', { name: 'Stock adjusted' })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/inventory/adjustments')?.body).toEqual({
      reason: 'count',
      note: '',
      items: [{ product: RICE_ID, mode: 'set', quantity: 8 }],
    });
  });

  it('writes off damaged stock as a removal, allowing fractions only for loose goods', async () => {
    const calls = mockApi(
      routes({
        'POST /api/inventory/adjustments': { status: 201, body: { adjusted: [], unchanged: [] } },
      }),
    );
    renderApp('/inventory/adjust');
    await userEvent.click(await screen.findByText('Damaged'));
    await pick('Basmati Rice', 'ric');
    await pick('Sugar', 'sug');
    await userEvent.type(screen.getByLabelText('Remove for Basmati Rice 5 kg'), '1.5');
    await userEvent.type(screen.getByLabelText('Remove for Sugar (loose)'), '0.5');
    await userEvent.click(screen.getByRole('button', { name: 'Review adjustment' }));
    expect(await screen.findByText('Counted in whole pcs')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Remove for Basmati Rice 5 kg'));
    await userEvent.type(screen.getByLabelText('Remove for Basmati Rice 5 kg'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Review adjustment' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply adjustment' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /api/inventory/adjustments')?.body).toMatchObject({
        reason: 'damaged',
        items: [
          { product: RICE_ID, mode: 'change', quantity: -2 },
          { product: SUGAR_ID, mode: 'change', quantity: -0.5 },
        ],
      }),
    );
  });

  it('refuses to remove more than is in stock', async () => {
    mockApi(routes());
    renderApp('/inventory/adjust');
    await userEvent.click(await screen.findByText('Lost or stolen'));
    await pick('Basmati Rice', 'ric');
    await userEvent.type(screen.getByLabelText('Remove for Basmati Rice 5 kg'), '11');
    await userEvent.click(screen.getByRole('button', { name: 'Review adjustment' }));
    expect(await screen.findByText('Only 10 pcs in stock')).toBeInTheDocument();
  });

  it('adds a product by scanning its barcode', async () => {
    const calls = mockApi(routes({ 'GET /api/products/lookup': { body: { product: RICE } } }));
    renderApp('/inventory/adjust');
    await userEvent.type(await screen.findByRole('combobox'), '2100000000017{Enter}');
    expect(await screen.findByLabelText('Counted for Basmati Rice 5 kg')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'GET /api/products/lookup')?.url).toBe(
      '/api/products/lookup?code=2100000000017',
    );
  });

  it('starts with the product when opened from a product page', async () => {
    mockApi(routes({ [`GET /api/products/${RICE_ID}`]: { body: { product: RICE } } }));
    renderApp(`/inventory/adjust?product=${RICE_ID}`);
    expect(await screen.findByLabelText('Counted for Basmati Rice 5 kg')).toBeInTheDocument();
  });

  it('is not available to cashiers', async () => {
    mockApi(routes({ 'POST /api/auth/refresh': session(makeUser('cashier')) }));
    renderApp('/inventory/adjust');
    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page" }),
    ).toBeInTheDocument();
  });
});
