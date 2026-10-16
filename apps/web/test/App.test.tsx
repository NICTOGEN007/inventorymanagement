import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the dashboard with live API status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ status: 'ok', database: 'connected' }), { status: 200 }),
        ),
    );
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('API and database online')).toBeInTheDocument();
  });

  it('reports when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderAt('/');
    expect(await screen.findByText('API or database unreachable')).toBeInTheDocument();
  });

  it('renders a not-found page for unknown routes', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
