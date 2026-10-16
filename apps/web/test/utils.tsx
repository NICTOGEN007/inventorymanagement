import type { Role, UserDto } from '@ims/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '@/App';
import { AuthProvider } from '@/auth/AuthProvider';

export interface MockResponse {
  status?: number;
  body?: unknown;
}
export interface RecordedCall {
  key: string;
  /** Path plus query string, e.g. "/api/products?search=milk". */
  url: string;
  body: unknown;
  headers: Record<string, string>;
}
type Handler = MockResponse | ((call: RecordedCall) => MockResponse | Promise<MockResponse>);

/**
 * Replaces fetch with a tiny fake API. Routes are keyed "METHOD /path";
 * unknown routes answer 404. Returns the list of calls made.
 */
export function mockApi(routes: Record<string, Handler>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const call: RecordedCall = {
        key: `${init?.method ?? 'GET'} ${url.pathname}`,
        url: url.pathname + url.search,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      const handler = routes[call.key] ?? routes[`${call.key}${url.search}`];
      const result = !handler
        ? {
            status: 404,
            body: { error: { code: 'NOT_FOUND', message: `No mock for ${call.key}` } },
          }
        : typeof handler === 'function'
          ? await handler(call)
          : handler;
      const status = result.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(result.body ?? {}), { status });
    }),
  );
  return calls;
}

export function makeUser(role: Role, overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: `${role}-id`,
    name: { admin: 'Asha Rao', manager: 'Vikram Shetty', cashier: 'Priya Nair' }[role],
    email: `${role}@stocksmart.test`,
    role,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export const session = (user: UserDto): MockResponse => ({
  body: { accessToken: `token-for-${user.id}`, expiresIn: 900, user },
});

export const noSession: MockResponse = {
  status: 401,
  body: { error: { code: 'REFRESH_MISSING', message: 'Not signed in' } },
};

export function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
