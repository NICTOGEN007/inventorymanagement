import type { DashboardDto, PeriodTotals, ReportDto } from '@ims/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { makeUser, mockApi, renderApp, session } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken(null);
});

const totals = (overrides: Partial<PeriodTotals> = {}): PeriodTotals => ({
  bills: 100,
  grossSales: 7_000_000,
  refunds: 50_000,
  returns: 2,
  netSales: 6_950_000,
  netTaxable: 6_500_000,
  netTax: 450_000,
  costOfGoods: 5_500_000,
  grossProfit: 1_000_000,
  margin: 15.4,
  averageBill: 69_500,
  ...overrides,
});

const dashboard = (): DashboardDto => ({
  period: { from: '2026-10-14', to: '2026-10-16' },
  previous: { from: '2026-10-11', to: '2026-10-13' },
  totals: totals(),
  previousTotals: totals({
    netSales: 5_000_000,
    grossProfit: 1_250_000,
    bills: 100,
    averageBill: 60_000,
  }),
  daily: ['2026-10-14', '2026-10-15', '2026-10-16'].map((date, i) => ({
    date,
    ...totals({ netSales: [2_000_000, 3_000_000, 1_950_000][i]!, bills: 30 + i }),
  })),
  topProducts: [
    {
      product: { id: '64b000000000000000000101', name: 'Basmati Rice 5 kg', unit: 'pcs' },
      quantity: 40,
      sales: 2_468_000,
      profit: 300_000,
    },
  ],
  payments: [
    { method: 'upi', bills: 60, amount: 4_000_000 },
    { method: 'cash', bills: 40, amount: 3_000_000 },
  ],
  stock: {
    costValue: 26_534_353,
    retailValue: 33_258_100,
    products: 44,
    lowStock: 14,
    outOfStock: 3,
    needsRestock: [
      { id: 'p1', name: 'Lemon Soda 600 ml', unit: 'pcs', stock: 0, reorderLevel: 41, onOrder: 0 },
      { id: 'p2', name: 'Poha 1 kg', unit: 'pcs', stock: 9, reorderLevel: 22, onOrder: 48 },
    ],
  },
});

describe('Dashboard', () => {
  it('shows the period’s figures against the previous period, the trend and what to restock', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/health': { body: { status: 'ok' } },
      'GET /api/reports/dashboard': { body: { dashboard: dashboard() } },
    });
    renderApp('/');
    expect(await screen.findByText('₹69,500.00')).toBeInTheDocument();
    // Up 39% on net sales (good), down 20% on profit (bad); arrows and signs, not just colour.
    expect(screen.getByText('+39%')).toBeInTheDocument();
    expect(screen.getByText('−20%')).toBeInTheDocument();
    expect(screen.getByText('No change')).toBeInTheDocument();
    expect(screen.getByText('15.4% margin on taxable value')).toBeInTheDocument();
    expect(screen.getByText('after ₹500.00 refunded on 2 returns')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Basmati Rice 5 kg' })).toBeInTheDocument();
    expect(screen.getByText('UPI · 60 bills')).toBeInTheDocument();
    expect(screen.getByText('57.1%')).toBeInTheDocument();
    expect(screen.getByText('0 pcs left · reorder at 41 pcs · not ordered')).toBeInTheDocument();
    expect(
      screen.getByText('9 pcs left · reorder at 22 pcs · 48 pcs on order'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() =>
      expect(calls.at(-1)?.url).toMatch(/^\/api\/reports\/dashboard\?from=\d{4}-\d\d-\d\d&to=/),
    );
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reads the trend out from the keyboard and as a table', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/health': { body: { status: 'ok' } },
      'GET /api/reports/dashboard': { body: { dashboard: dashboard() } },
    });
    renderApp('/');
    const chart = await screen.findByRole('group', { name: /Net sales chart/ });
    act(() => chart.focus());
    expect(chart).toHaveAccessibleDescription(/Fri, 16 Oct,? 2026: Net sales ₹19,500.00, bills 32/);
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(chart).toHaveAccessibleDescription(/Thu, 15 Oct,? 2026: Net sales ₹30,000.00/);
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(chart).toHaveAccessibleDescription(/Wed, 14 Oct,? 2026/);

    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }));
    const table = screen.getByRole('table', { name: 'Net sales' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('₹30,000.00')).toBeInTheDocument();
  });
});

const salesReport = (): ReportDto => ({
  kind: 'sales',
  title: 'Sales report',
  subtitle: '1 Oct 2026 – 16 Oct 2026',
  period: { from: '2026-10-01', to: '2026-10-16' },
  generatedAt: '2026-10-16T10:00:00.000Z',
  highlights: [
    { label: 'Net sales', value: 41_244_600, type: 'money' },
    { label: 'Margin', value: 14.8, type: 'percent' },
  ],
  sections: [
    {
      id: 'periods',
      title: 'By week',
      columns: [
        { key: 'period', label: 'Period', type: 'text' },
        { key: 'bills', label: 'Bills', type: 'number' },
        { key: 'netSales', label: 'Net sales', type: 'money' },
        { key: 'grossProfit', label: 'Gross profit', type: 'money' },
      ],
      rows: [
        {
          bucket: '2026-09-28',
          period: 'Week of 28 Sep',
          bills: 196,
          netSales: 13_692_400,
          grossProfit: 1_932_100,
        },
        {
          bucket: '2026-10-05',
          period: 'Week of 5 Oct',
          bills: 260,
          netSales: 18_000_000,
          grossProfit: -5_000,
        },
      ],
      totals: { period: 'Total', bills: 456, netSales: 31_692_400, grossProfit: 1_927_100 },
    },
    {
      id: 'cashiers',
      title: 'By cashier',
      columns: [{ key: 'cashier', label: 'Cashier', type: 'text' }],
      rows: [],
      empty: 'No sales in this period.',
    },
  ],
});

describe('Reports', () => {
  it('shows a report’s figures and tables and changes grouping through the URL', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/categories': { body: { data: [] } },
      'GET /api/reports/sales': { body: { report: salesReport() } },
    });
    renderApp('/reports');
    expect(await screen.findByText('Sales report · 1 Oct 2026 – 16 Oct 2026')).toBeInTheDocument();
    expect(screen.getByText('₹4,12,446.00')).toBeInTheDocument();
    expect(screen.getByText('14.8%')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'By week' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Week of 28 Sep196₹1,36,924.00₹19,321.00');
    expect(rows[2]).toHaveTextContent('−₹50.00');
    expect(rows.at(-1)).toHaveTextContent('Total456₹3,16,924.00');
    expect(screen.getByText('No sales in this period.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download By cashier as CSV' })).toBeDisabled();
    // A chart of the same rows sits above the tables.
    expect(screen.getByRole('group', { name: /Net sales chart/ })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'month');
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/reports/sales?groupBy=month'));
  });

  it('downloads a table as CSV and the whole report as PDF for the period shown', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('admin')),
      'GET /api/categories': { body: { data: [] } },
      'GET /api/reports/sales': ({ url }) =>
        url.includes('format=') ? { body: {} } : { body: { report: salesReport() } },
    });
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }),
    );
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    renderApp('/reports');
    await userEvent.click(await screen.findByRole('button', { name: 'Download By week as CSV' }));
    await waitFor(() =>
      expect(names).toEqual(['sales-report-2026-10-01-to-2026-10-16-periods.csv']),
    );
    expect(
      calls.some(
        (c) =>
          c.url === '/api/reports/sales?from=2026-10-01&to=2026-10-16&format=csv&section=periods',
      ),
    ).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(names).toHaveLength(2));
    expect(names[1]).toBe('sales-report-2026-10-01-to-2026-10-16.pdf');
  });

  it('is not open to cashiers', async () => {
    mockApi({ 'POST /api/auth/refresh': session(makeUser('cashier')) });
    renderApp('/reports/gst');
    expect(
      await screen.findByRole('heading', { name: /permission|not allowed|access/i }),
    ).toBeInTheDocument();
  });
});
