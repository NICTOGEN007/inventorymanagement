import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { makeUser, mockApi, noSession, renderApp, session } from './utils';

const health = { body: { status: 'ok', database: 'connected' } };

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe('signing in', () => {
  it('sends anonymous visitors to the login page', async () => {
    mockApi({ 'POST /api/auth/refresh': noSession });
    renderApp('/products');
    expect(
      await screen.findByRole('heading', { name: 'Sign in to StockSmart' }),
    ).toBeInTheDocument();
  });

  it('validates the form before calling the API', async () => {
    const calls = mockApi({ 'POST /api/auth/refresh': noSession });
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(calls.filter((c) => c.key === 'POST /api/auth/login')).toHaveLength(0);
  });

  it('shows the server message when sign-in fails', async () => {
    mockApi({
      'POST /api/auth/refresh': noSession,
      'POST /api/auth/login': {
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } },
      },
    });
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'admin@stocksmart.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('signs in with a demo account and returns to the page that was asked for', async () => {
    const admin = makeUser('admin');
    const calls = mockApi({
      'POST /api/auth/refresh': noSession,
      'POST /api/auth/login': session(admin),
      'GET /api/users': { body: { data: [admin] } },
    });
    renderApp('/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Admin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/auth/login')?.body).toEqual({
      email: 'admin@stocksmart.test',
      password: 'Admin@123',
    });
    // Later requests carry the access token.
    expect(calls.find((c) => c.key === 'GET /api/users')?.headers.Authorization).toBe(
      'Bearer token-for-admin-id',
    );
  });

  it('restores an existing session on page load', async () => {
    mockApi({ 'POST /api/auth/refresh': session(makeUser('manager')), 'GET /api/health': health });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/Good (morning|afternoon|evening), Vikram/)).toBeInTheDocument();
  });

  it('signs out', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('admin')),
      'POST /api/auth/logout': { status: 204 },
      'GET /api/health': health,
    });
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to StockSmart' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/auth/logout')).toBe(true);
  });
});

describe('role-based access', () => {
  it('shows admins every module, including Users', async () => {
    mockApi({ 'POST /api/auth/refresh': session(makeUser('admin')), 'GET /api/health': health });
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(within(nav).getAllByRole('link')).toHaveLength(9);
  });

  it('hides user management from managers', async () => {
    mockApi({ 'POST /api/auth/refresh': session(makeUser('manager')), 'GET /api/health': health });
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Reports' })).toBeInTheDocument();
  });

  it('sends cashiers to billing and keeps them out of other modules', async () => {
    mockApi({ 'POST /api/auth/refresh': session(makeUser('cashier')) });
    const { unmount } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Point of Sale' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav)
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(links).toEqual(['Point of Sale', 'Products', 'Inventory', 'Customers']);
    unmount();

    renderApp('/users');
    expect(
      await screen.findByRole('heading', { name: "You don't have access to this page" }),
    ).toBeInTheDocument();
  });

  it('returns to the login page when the session cannot be renewed', async () => {
    let refreshes = 0;
    mockApi({
      'POST /api/auth/refresh': () => (++refreshes === 1 ? session(makeUser('admin')) : noSession),
      'GET /api/users': {
        status: 401,
        body: { error: { code: 'TOKEN_EXPIRED', message: 'expired' } },
      },
    });
    renderApp('/users');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Sign in to StockSmart' })).toBeInTheDocument(),
    );
  });
});
