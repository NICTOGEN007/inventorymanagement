import type { CategoryDto, ProductDto, SupplierDto } from '@ims/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { makeUser, mockApi, renderApp, session } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

const now = '2026-10-01T00:00:00.000Z';
const category = (id: string, name: string, productCount: number): CategoryDto => ({
  id,
  name,
  isActive: true,
  productCount,
  createdAt: now,
  updatedAt: now,
});
const CATEGORIES = [
  category('64b000000000000000000001', 'Dairy', 2),
  category('64b000000000000000000002', 'Bakery', 0),
];
const SUPPLIER: SupplierDto = {
  id: '64b000000000000000000003',
  name: 'Greenfield Dairy',
  stateCode: '29',
  leadTimeDays: 1,
  isActive: true,
  productCount: 2,
  createdAt: now,
  updatedAt: now,
};

const product = (overrides: Partial<ProductDto>): ProductDto => ({
  id: 'p1',
  sku: 'DRY-001',
  name: 'Toned Milk 1 L',
  category: { id: '64b000000000000000000001', name: 'Dairy' },
  brand: 'Greenfield',
  unit: 'pcs',
  hsnCode: '0401',
  gstRate: 0,
  costPrice: 5264,
  sellingPrice: 5600,
  mrp: 5600,
  taxInclusive: true,
  stock: 40,
  reorderLevel: 20,
  reorderQuantity: 48,
  packSize: 1,
  stockStatus: 'ok',
  onOrder: 0,
  preferredSupplier: { id: '64b000000000000000000003', name: 'Greenfield Dairy' },
  isActive: true,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});
const MILK = product({});
const CURD = product({
  id: 'p2',
  sku: 'DRY-004',
  name: 'Curd 400 g',
  stock: 4,
  reorderLevel: 22,
  stockStatus: 'low',
  onOrder: 72,
  gstRate: 5,
});

const page = (data: ProductDto[]) => ({
  body: { data, page: 1, pageSize: 20, total: data.length },
});

describe('Products list', () => {
  it('shows prices, stock warnings and quantities on order', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/categories': { body: { data: CATEGORIES } },
      'GET /api/products': page([CURD, MILK]),
    });
    renderApp('/products');
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Curd 400 g');
    expect(rows[1]).toHaveTextContent('Low stock');
    expect(rows[1]).toHaveTextContent('72 pcs on order');
    expect(rows[2]).toHaveTextContent('₹56.00');
    expect(screen.getByRole('link', { name: 'Add product' })).toBeInTheDocument();
  });

  it('searches after typing pauses and filters through the URL', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/categories': { body: { data: CATEGORIES } },
      'GET /api/products': ({ url }) => page(url.includes('search=curd') ? [CURD] : [CURD, MILK]),
    });
    renderApp('/products');
    await screen.findByRole('table');
    await userEvent.type(screen.getByLabelText('Search products'), 'curd');
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2),
    );
    const searches = calls.filter((c) => c.key === 'GET /api/products').map((c) => c.url);
    expect(searches.at(-1)).toBe('/api/products?search=curd');
    expect(searches).not.toContain('/api/products?search=c'); // debounced

    await userEvent.selectOptions(screen.getByLabelText('Stock level'), 'low');
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/products?search=curd&stock=low'));
  });

  it('keeps a cleared filter cleared when searching straight after (regression)', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/categories': { body: { data: CATEGORIES } },
      'GET /api/products': page([CURD, MILK]),
    });
    renderApp('/products?stock=out');
    await screen.findByRole('table');
    // Clear the filter and type in the same moment, as a quick user does.
    act(() => {
      fireEvent.change(screen.getByLabelText('Stock level'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'milk' } });
    });
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/products?search=milk'));
    // Give a stale update time to appear, then check none did.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls.at(-1)?.url).toBe('/api/products?search=milk');
    expect(calls.some((c) => c.url.includes('search=milk') && c.url.includes('stock=out'))).toBe(
      false,
    );
  });

  it('is read-only for cashiers', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('cashier')),
      'GET /api/categories': { body: { data: CATEGORIES } },
      'GET /api/products': page([MILK]),
    });
    renderApp('/products');
    await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'Add product' })).not.toBeInTheDocument();
    renderApp('/products/new');
    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page" }),
    ).toBeInTheDocument();
  });
});

describe('Product form', () => {
  const routes = (extra = {}) => ({
    'POST /api/auth/refresh': session(makeUser('manager')),
    'GET /api/categories': { body: { data: CATEGORIES } },
    'GET /api/suppliers': { body: { data: [SUPPLIER] } },
    ...extra,
  });

  async function fillValidProduct() {
    await userEvent.type(await screen.findByLabelText('Product name'), 'Basmati Rice 5 kg');
    await userEvent.type(screen.getByLabelText('SKU'), 'stp-011');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Dairy');
    await userEvent.type(screen.getByLabelText('HSN code'), '1006');
    await userEvent.selectOptions(screen.getByLabelText('GST rate'), '18');
    await userEvent.type(screen.getByLabelText('Selling price'), '118');
    await userEvent.type(screen.getByLabelText('Cost price (excl. GST)'), '80');
  }

  it('shows a live price breakdown and sends paise to the API', async () => {
    const calls = mockApi(
      routes({
        'POST /api/products': {
          status: 201,
          body: { product: product({ id: '64b000000000000000000010', name: 'Basmati Rice 5 kg' }) },
        },
      }),
    );
    renderApp('/products/new');
    await fillValidProduct();

    const breakdown = screen.getByLabelText('Price breakdown');
    expect(breakdown).toHaveTextContent('Before GST₹100.00');
    expect(breakdown).toHaveTextContent('GST (18%)₹18.00');
    expect(breakdown).toHaveTextContent('Your margin₹20.00 (20%)');

    await userEvent.type(screen.getByLabelText('Opening stock'), '0'); // "0" -> "00"
    await userEvent.click(screen.getByRole('button', { name: 'Add product' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/products')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /api/products')?.body).toMatchObject({
      name: 'Basmati Rice 5 kg',
      sku: 'stp-011',
      category: '64b000000000000000000001',
      gstRate: 18,
      sellingPrice: 11800,
      costPrice: 8000,
      taxInclusive: true,
      openingStock: 0,
    });
    // Lands on the new product's page, shown from the save response without another request.
    expect(await screen.findByRole('heading', { name: 'Basmati Rice 5 kg' })).toBeInTheDocument();
  });

  it('checks barcodes and prices before sending', async () => {
    const calls = mockApi(routes());
    renderApp('/products/new');
    await fillValidProduct();
    await userEvent.type(screen.getByLabelText('Barcode (optional)'), '4006381333932');
    await userEvent.type(screen.getByLabelText('MRP (optional)'), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Add product' }));
    expect(
      await screen.findByText('Not a valid EAN/UPC barcode (check the digits)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Selling price cannot be more than the MRP')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/products')).toBe(false);
  });

  it('puts a duplicate SKU error from the server on the SKU field', async () => {
    mockApi(
      routes({
        'POST /api/products': {
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message: 'SKU is already in use',
              details: [{ path: ['sku'], message: 'SKU is already in use' }],
            },
          },
        },
      }),
    );
    renderApp('/products/new');
    await fillValidProduct();
    await userEvent.click(screen.getByRole('button', { name: 'Add product' }));
    const sku = screen.getByLabelText('SKU');
    expect(await screen.findByText('SKU is already in use')).toBeInTheDocument();
    expect(sku).toHaveAttribute('aria-invalid', 'true');
  });

  it('edits a product, sending cleared fields as null and no opening stock', async () => {
    const calls = mockApi(
      routes({
        'GET /api/products/p1': { body: { product: MILK } },
        'PATCH /api/products/p1': { body: { product: { ...MILK, brand: undefined } } },
      }),
    );
    renderApp('/products/p1/edit');
    const brand = await screen.findByLabelText('Brand (optional)');
    expect(brand).toHaveValue('Greenfield');
    expect(screen.getByLabelText('Selling price')).toHaveValue('56');
    expect(screen.queryByLabelText('Opening stock')).not.toBeInTheDocument();

    await userEvent.clear(brand);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /api/products/p1')).toBe(true));
    const body = calls.find((c) => c.key === 'PATCH /api/products/p1')!.body as Record<
      string,
      unknown
    >;
    expect(body.brand).toBeNull();
    expect(body.sellingPrice).toBe(5600);
    expect(body).not.toHaveProperty('openingStock');
    expect(body).not.toHaveProperty('stock');
  });
});

describe('Suppliers and categories', () => {
  it('fills in the state from the GSTIN', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/suppliers': { body: { data: [SUPPLIER] } },
      'POST /api/suppliers': { status: 201, body: { supplier: SUPPLIER } },
    });
    renderApp('/suppliers');
    await userEvent.click(await screen.findByRole('button', { name: 'Add supplier' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Business name'), 'Western FMCG Traders');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), '27AAPFU0939F1ZV');
    expect(within(dialog).getByLabelText('State')).toHaveValue('27');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add supplier' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /api/suppliers')?.body).toMatchObject({
        name: 'Western FMCG Traders',
        gstin: '27AAPFU0939F1ZV',
        stateCode: '27',
        leadTimeDays: 3,
      }),
    );
  });

  it('offers delete only for empty categories', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/categories': { body: { data: CATEGORIES } },
    });
    renderApp('/products/categories');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Delete Dairy' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Bakery' })).toBeInTheDocument();
  });
});
