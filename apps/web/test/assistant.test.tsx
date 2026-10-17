import type { RestockPlanDto } from '@ims/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMarkdown } from '@/components/ChatMarkdown';
import { setAccessToken } from '@/lib/api';
import { makeUser, mockApi, renderApp, session } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken(null);
  sessionStorage.clear();
});

const plan = (overrides: Partial<RestockPlanDto> = {}): RestockPlanDto => ({
  id: 'plan1',
  planNumber: 'RST/26-27/00003',
  status: 'draft',
  source: 'assistant',
  itemCount: 1,
  supplierCount: 1,
  budget: 5_000_000,
  taxable: 2_145_000,
  cgst: 53_625,
  sgst: 53_625,
  igst: 0,
  total: 2_252_250,
  createdAt: '2026-10-17T04:00:00.000Z',
  expiresAt: '2099-10-18T04:00:00.000Z',
  groups: [
    {
      supplier: { id: 's1', name: 'Karnataka Agro', leadTimeDays: 3 },
      interState: false,
      items: [
        {
          product: { id: 'p1', name: 'Sunflower Oil 1 L', sku: 'STP-006', unit: 'pcs' },
          stock: 0,
          onOrder: 0,
          dailyDemand: 11,
          daysUntilStockout: 0,
          packSize: 6,
          suggestedQuantity: 150,
          quantity: 150,
          unitCost: 14300,
          gstRate: 5,
          reasons: ['Out of stock now'],
          taxable: 2_145_000,
          cgst: 53_625,
          sgst: 53_625,
          igst: 0,
          total: 2_252_250,
        },
      ],
      taxable: 2_145_000,
      cgst: 53_625,
      sgst: 53_625,
      igst: 0,
      total: 2_252_250,
    },
  ],
  skipped: [],
  ...overrides,
});

describe('AI assistant', () => {
  it('explains how to turn it on when there is no key', async () => {
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/assistant/status': { body: { enabled: false } },
    });
    renderApp('/assistant');
    expect(
      await screen.findByRole('heading', { name: 'The assistant is not set up yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText('GEMINI_API_KEY')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your question')).not.toBeInTheDocument();
  });

  it('asks a question and shows the answer', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/assistant/status': { body: { enabled: true, model: 'gemini-2.5-flash' } },
      'POST /api/assistant/chat': {
        body: {
          reply: 'Net sales were **₹2,10,450.00**:\n- 245 bills\n- up 4%',
          toolsUsed: ['get_sales_summary'],
        },
      },
    });
    renderApp('/assistant');
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'How were sales this week compared with last week?',
      }),
    );
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(await within(log).findByText('₹2,10,450.00')).toHaveProperty('tagName', 'STRONG');
    expect(within(log).getByRole('list')).toHaveTextContent('245 bills');
    expect(calls.find((c) => c.key === 'POST /api/assistant/chat')?.body).toEqual({
      messages: [{ role: 'user', content: 'How were sales this week compared with last week?' }],
    });

    // A follow-up sends the conversation so far; Enter sends.
    await userEvent.type(screen.getByLabelText('Your question'), 'And last month?{Enter}');
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'POST /api/assistant/chat')).toHaveLength(2),
    );
    expect(calls.filter((c) => c.key === 'POST /api/assistant/chat')[1]!.body).toEqual({
      messages: [
        { role: 'user', content: 'How were sales this week compared with last week?' },
        { role: 'assistant', content: 'Net sales were **₹2,10,450.00**:\n- 245 bills\n- up 4%' },
        { role: 'user', content: 'And last month?' },
      ],
    });
  });

  it('shows a plan the assistant prepared, and only the owner confirms it', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/assistant/status': { body: { enabled: true, model: 'gemini-2.5-flash' } },
      'POST /api/assistant/chat': {
        body: {
          reply: 'I prepared RST/26-27/00003. Check it and press Confirm & place orders.',
          toolsUsed: ['create_restock_plan'],
          plan: plan(),
        },
      },
      'POST /api/restock/plans/plan1/confirm': {
        body: {
          plan: plan({
            status: 'confirmed',
            groups: plan().groups.map((g) => ({
              ...g,
              purchaseOrder: { id: 'po1', poNumber: 'PO/26-27/00460' },
            })),
          }),
        },
      },
    });
    renderApp('/assistant');
    await userEvent.type(
      await screen.findByLabelText('Your question'),
      'Restock, keep it under 50000',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Restock plan')).toBeInTheDocument();
    expect(
      screen.getByText(/1 item from 1 supplier, ₹22,522.50 incl. GST \(budget ₹50,000.00\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review and edit/ })).toHaveAttribute(
      'href',
      '/restock/plans/plan1',
    );
    expect(calls.some((c) => c.key.endsWith('/confirm'))).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Confirm & place orders' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Place 1 order' }),
    );
    expect(await screen.findByText('Confirmed')).toBeInTheDocument();
    expect(calls.filter((c) => c.key === 'POST /api/restock/plans/plan1/confirm')).toHaveLength(1);
  });

  it('says when the assistant is busy and lets you try again', async () => {
    let attempts = 0;
    mockApi({
      'POST /api/auth/refresh': session(makeUser('manager')),
      'GET /api/assistant/status': { body: { enabled: true, model: 'gemini-2.5-flash' } },
      'POST /api/assistant/chat': () =>
        ++attempts === 1
          ? {
              status: 503,
              body: {
                error: {
                  code: 'ASSISTANT_UNAVAILABLE',
                  message: 'The AI assistant is busy (free-tier limit). Try again in a minute.',
                },
              },
            }
          : { body: { reply: 'Here you go.', toolsUsed: [] } },
    });
    renderApp('/assistant');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Which products will run out soon?' }),
    );
    expect(await screen.findByText(/The AI assistant is busy/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Here you go.')).toBeInTheDocument();
  });

  it('is not open to cashiers', async () => {
    mockApi({ 'POST /api/auth/refresh': session(makeUser('cashier')) });
    renderApp('/assistant');
    expect(
      await screen.findByRole('heading', { name: /permission|not allowed|access/i }),
    ).toBeInTheDocument();
  });
});

describe('ChatMarkdown', () => {
  it('renders lists and bold, and never markup from the reply', () => {
    const { container } = render(
      <ChatMarkdown text={'## Top\n1. **Rice** <img src=x onerror=alert(1)>\n2. Atta\n\nDone.'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('ol')?.children).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('Rice');
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});
