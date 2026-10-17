import type {
  ForecastItemDto,
  ForecastOverviewDto,
  ProductForecastDto,
  RestockAlertDto,
  RestockPlanDto,
} from '@ims/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { makeUser, mockApi, renderApp, session } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken(null);
});

const OIL = '64b000000000000000000201';
const MILK = '64b000000000000000000202';
const CARDS = '64b000000000000000000203';

const item = (overrides: Partial<ForecastItemDto>): ForecastItemDto => ({
  product: { id: OIL, name: 'Sunflower Oil 1 L', sku: 'STP-006', unit: 'pcs' },
  supplier: { id: 's1', name: 'Karnataka Agro', leadTimeDays: 3 },
  stock: 0,
  onOrder: 0,
  packSize: 6,
  reorderLevel: 10,
  status: 'reorder',
  method: 'holt-winters',
  dailyDemand: 11.06,
  leadTimeDemand: 40,
  safetyStock: 21,
  reorderPoint: 61,
  suggestedQuantity: 150,
  daysUntilStockout: 0,
  reasons: ['Sells about 11 a day', 'Out of stock now', 'Supplier takes 3 days'],
  unitCost: 14300,
  gstRate: 5,
  ...overrides,
});

const overview = (): ForecastOverviewDto => ({
  asOf: '2026-10-16',
  items: [
    item({}),
    item({
      product: { id: MILK, name: 'Toned Milk 1 L', sku: 'DRY-001', unit: 'pcs' },
      status: 'ok',
      stock: 200,
      suggestedQuantity: 0,
      daysUntilStockout: 9,
      reasons: ['Sells about 21 a day', '200 left: about 9 days', 'Supplier takes 1 day'],
    }),
    item({
      product: { id: CARDS, name: 'Greeting Cards', sku: 'STN-003', unit: 'pack' },
      status: 'dead',
      stock: 13,
      suggestedQuantity: 0,
      daysUntilStockout: null,
      reasons: ['No sale in 150 days, so it is not reordered'],
    }),
  ],
  counts: { reorder: 1, watch: 0, ordered: 0, ok: 1, dead: 1, new: 0 },
});

const alerts = (overrides: Partial<RestockAlertDto> = {}): RestockAlertDto => ({
  reorder: 1,
  runningOut: 1,
  outOfStock: 1,
  items: [{ id: OIL, name: 'Sunflower Oil 1 L', daysUntilStockout: 0 }],
  ...overrides,
});

const line = (overrides: Partial<RestockPlanDto['groups'][number]['items'][number]> = {}) => ({
  product: { id: OIL, name: 'Sunflower Oil 1 L', sku: 'STP-006', unit: 'pcs' as const },
  stock: 0,
  onOrder: 0,
  dailyDemand: 11.06,
  daysUntilStockout: 0,
  packSize: 6,
  suggestedQuantity: 150,
  quantity: 150,
  unitCost: 14300,
  gstRate: 5 as const,
  reasons: ['Sells about 11 a day', 'Out of stock now'],
  taxable: 2_145_000,
  cgst: 53_625,
  sgst: 53_625,
  igst: 0,
  total: 2_252_250,
  ...overrides,
});

const plan = (overrides: Partial<RestockPlanDto> = {}): RestockPlanDto => ({
  id: 'plan1',
  planNumber: 'RST/26-27/00001',
  status: 'draft',
  source: 'alert',
  itemCount: 2,
  supplierCount: 2,
  taxable: 2_195_000,
  cgst: 53_625,
  sgst: 53_625,
  igst: 9_000,
  total: 2_311_250,
  createdAt: '2026-10-17T04:00:00.000Z',
  expiresAt: '2099-10-18T04:00:00.000Z',
  createdBy: { id: 'manager-id', name: 'Vikram Shetty' },
  groups: [
    {
      supplier: { id: 's1', name: 'Karnataka Agro', leadTimeDays: 3 },
      interState: false,
      items: [line()],
      taxable: 2_145_000,
      cgst: 53_625,
      sgst: 53_625,
      igst: 0,
      total: 2_252_250,
    },
    {
      supplier: { id: 's2', name: 'Western FMCG', leadTimeDays: 6 },
      interState: true,
      items: [
        line({
          product: { id: MILK, name: 'Bath Soap', sku: 'PRC-001', unit: 'pack' },
          quantity: 12,
          suggestedQuantity: 12,
          packSize: 12,
          taxable: 50_000,
          cgst: 0,
          sgst: 0,
          igst: 9_000,
          total: 59_000,
          reasons: ['Sells about 2 pack a day'],
        }),
      ],
      taxable: 50_000,
      cgst: 0,
      sgst: 0,
      igst: 9_000,
      total: 59_000,
    },
  ],
  skipped: [
    { product: { id: 'p9', name: 'Loose Jaggery' }, reason: 'No preferred supplier is set' },
  ],
  ...overrides,
});

describe('Smart Restock', () => {
  it('lists what to reorder, why, and filters by status', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/forecast': { body: { overview: overview() } },
      'GET /api/forecast/accuracy': {
        body: {
          accuracy: {
            mape: 44,
            wape: 29.6,
            bias: 4,
            baseline: { mape: 50.3, wape: 31.9, bias: 9.8 },
            products: 42,
            weeks: 144,
          },
        },
      },
      'GET /api/restock/alerts': {
        body: {
          alerts: alerts({
            openPlan: { id: 'plan1', planNumber: 'RST/26-27/00001', itemCount: 8 },
          }),
        },
      },
    });
    renderApp('/restock');
    const table = await screen.findByRole('table', { name: /Demand forecast/ });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('Sunflower Oil 1 L');
    expect(rows[1]).toHaveTextContent('Reorder now');
    expect(rows[1]).toHaveTextContent('Out of stock');
    expect(rows[1]).toHaveTextContent('150 pcs');
    // 150 × ₹143 before GST.
    expect(rows[1]).toHaveTextContent('₹21,450.00 + GST');
    expect(
      within(rows[1]!).getAllByText(/Sells about 11 a day · Out of stock now/)[0],
    ).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent('Not selling');

    expect(screen.getByText('29.6%')).toBeInTheDocument();
    expect(screen.getByText('Weekly, last 4 weeks. A moving average: 31.9%')).toBeInTheDocument();
    expect(screen.getByText(/RST\/26-27\/00001/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review plan/ })).toHaveAttribute(
      'href',
      '/restock/plans/plan1',
    );

    await userEvent.click(screen.getByRole('button', { name: /^Not selling/ }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(table).toHaveTextContent('Greeting Cards');
  });

  it('prepares a plan with a budget and opens it', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/forecast': { body: { overview: overview() } },
      'GET /api/forecast/accuracy': { body: { accuracy: null } },
      'GET /api/restock/alerts': { body: { alerts: alerts() } },
      'GET /api/suppliers': { body: { data: [] } },
      'POST /api/restock/plans': { status: 201, body: { plan: plan() } },
      'GET /api/restock/plans/plan1': { body: { plan: plan() } },
    });
    renderApp('/restock');
    await userEvent.click(await screen.findByRole('button', { name: 'Prepare restock plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Prepare a restock plan' });
    await userEvent.type(within(dialog).getByLabelText(/Budget/), '50000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Prepare plan' }));
    expect(
      await screen.findByRole('heading', { name: /Restock plan RST\/26-27\/00001/ }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/restock/plans')?.body).toEqual({
      budget: 5_000_000,
    });
  });

  it('is not shown to cashiers', async () => {
    mockApi({ 'POST /api/auth/refresh': session(makeUser('cashier')) });
    renderApp('/restock');
    expect(
      await screen.findByRole('heading', { name: /permission|not allowed|access/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Smart Restock' })).not.toBeInTheDocument();
  });
});

describe('Restock plan', () => {
  it('lets the owner change quantities, remove lines and save before confirming', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/restock/plans/plan1': { body: { plan: plan() } },
      'PATCH /api/restock/plans/plan1': ({ body }) => ({
        body: {
          plan: plan({
            itemCount: 1,
            supplierCount: 1,
            groups: [
              {
                ...plan().groups[0]!,
                items: [
                  line({
                    quantity: (body as { items: { quantity: number }[] }).items[0]!.quantity,
                  }),
                ],
              },
            ],
          }),
        },
      }),
    });
    renderApp('/restock/plans/plan1');
    const oil = await screen.findByLabelText('Quantity of Sunflower Oil 1 L');
    expect(
      screen.getByText('Prepared from the dashboard alert by Vikram Shetty', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText('Delivers in 6 days · IGST')).toBeInTheDocument();
    expect(screen.getByText(/Loose Jaggery/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm & place orders' });
    expect(confirm).toBeEnabled();

    await userEvent.clear(oil);
    await userEvent.type(oil, '100.5');
    expect(screen.getByText('Whole pcs only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(confirm).toBeDisabled();

    await userEvent.clear(oil);
    await userEvent.type(oil, '100');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bath Soap' }));
    expect(screen.getByText('Removed: save to keep this change')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/restock/plans/plan1')?.body).toEqual({
        items: [{ product: OIL, quantity: 100 }],
      }),
    );
    await waitFor(() => expect(screen.queryByText('Bath Soap')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Confirm & place orders' })).toBeEnabled();
  });

  it('places the orders only when the owner confirms', async () => {
    const confirmed = plan({
      status: 'confirmed',
      confirmedAt: '2026-10-17T05:00:00.000Z',
      confirmedBy: { id: 'manager-id', name: 'Vikram Shetty' },
      groups: plan().groups.map((g, i) => ({
        ...g,
        purchaseOrder: { id: `po${i}`, poNumber: `PO/26-27/0045${i}` },
      })),
    });
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/restock/plans/plan1': { body: { plan: plan() } },
      'POST /api/restock/plans/plan1/confirm': { body: { plan: confirmed } },
    });
    renderApp('/restock/plans/plan1');
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm & place orders' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm and place the orders?' });
    expect(dialog).toHaveTextContent(
      'This places 2 purchase orders, ₹23,112.50 in all incl. GST, with Karnataka Agro, Western FMCG.',
    );
    expect(calls.some((c) => c.key === 'POST /api/restock/plans/plan1/confirm')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Place 2 orders' }));

    expect(await screen.findAllByRole('link', { name: 'PO/26-27/00450' })).not.toHaveLength(0);
    expect(screen.getAllByRole('link', { name: 'PO/26-27/00451' })[0]).toHaveAttribute(
      'href',
      '/purchases/po1',
    );
    expect(screen.queryByLabelText('Quantity of Sunflower Oil 1 L')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm & place orders' }),
    ).not.toBeInTheDocument();
  });

  it('explains an expired plan and offers a new one', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/restock/plans/plan1': {
        body: { plan: plan({ status: 'expired', expiredReason: 'Replaced by RST/26-27/00002' }) },
      },
    });
    renderApp('/restock/plans/plan1');
    expect(await screen.findByText('This plan expired:')).toBeInTheDocument();
    expect(screen.getByText(/Replaced by RST\/26-27\/00002/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare a new plan' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm & place orders' }),
    ).not.toBeInTheDocument();
  });
});

describe('Dashboard alert', () => {
  it('says what needs restocking and prepares a plan from the alert', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/health': { body: { status: 'ok' } },
      'GET /api/restock/alerts': { body: { alerts: alerts({ reorder: 6, outOfStock: 3 }) } },
      'POST /api/restock/plans': { status: 201, body: { plan: plan() } },
      'GET /api/restock/plans/plan1': { body: { plan: plan() } },
    });
    renderApp('/');
    expect(
      await screen.findByText('6 products need restocking, 3 already out of stock'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sunflower Oil 1 L and 5 more.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Prepare restock plan' }));
    expect(await screen.findByRole('heading', { name: /Restock plan/ })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/restock/plans')?.body).toEqual({
      source: 'alert',
    });
  });
});

describe('Product forecast', () => {
  it('shows the forecast, the reasons and how the model was fitted', async () => {
    const forecast: ProductForecastDto = {
      item: item({}),
      history: [
        { date: '2026-10-15', quantity: 12, stockedOut: false },
        { date: '2026-10-16', quantity: 0, stockedOut: true },
      ],
      forecast: [
        { date: '2026-10-17', expected: 11.2, low: 6, high: 16.4 },
        { date: '2026-10-18', expected: 13, low: 7, high: 19, festival: 'Dussehra' },
      ],
      model: {
        method: 'holt-winters',
        alpha: 0.05,
        beta: 0,
        gamma: 0.1,
        historyDays: 364,
        season: [1.6, 2.2, -2.5, -2, -2.7, 0.5, 2.9],
        festivalUplift: { Holi: 1.2 },
        generalUplift: 1,
      },
      backtest: {
        mape: 25.6,
        baselineMape: 10.5,
        weeks: 1,
        totals: { actual: 1, forecast: 1, error: 0, baselineForecast: 1, baselineError: 0 },
      },
    };
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      [`GET /api/forecast/products/${OIL}`]: { body: { forecast } },
    });
    renderApp(`/restock/products/${OIL}`);
    expect(await screen.findByRole('heading', { name: 'Sunflower Oil 1 L' })).toBeInTheDocument();
    expect(screen.getByText('11 a day')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: /Sunflower Oil 1 L daily sales chart/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/learned from 364 days of sales/)).toBeInTheDocument();
    expect(screen.getByText(/On the last week of normal trading/)).toHaveTextContent(
      'weekly error 26%, against 11% for a moving average',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByRole('table', { name: 'Sunflower Oil 1 L daily sales' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(rows[2]).toHaveTextContent('Shelf empty');
    expect(rows[4]).toHaveTextContent('Dussehra build-up');
  });
});
