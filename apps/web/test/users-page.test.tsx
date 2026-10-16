import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from '@/lib/api';
import { makeUser, mockApi, renderApp, session } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

const admin = makeUser('admin');
const cashier = makeUser('cashier', {
  lastLoginAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
});
const inactive = makeUser('manager', { id: 'old-id', name: 'Old Manager', isActive: false });

describe('Users page', () => {
  it('lists staff with roles, status and last sign-in', async () => {
    mockApi({
      'POST /api/auth/refresh': session(admin),
      'GET /api/users': { body: { data: [admin, cashier, inactive] } },
    });
    renderApp('/users');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('(you)');
    expect(rows[2]).toHaveTextContent('Cashier');
    expect(rows[2]).toHaveTextContent('2 hours ago');
    expect(rows[3]).toHaveTextContent('Inactive');
    // You cannot reset your own password from here (use My account instead).
    expect(
      within(rows[1]!).queryByRole('button', { name: /Reset password/ }),
    ).not.toBeInTheDocument();
  });

  it('adds a user and reports a duplicate email on the field', async () => {
    let attempt = 0;
    const calls = mockApi({
      'POST /api/auth/refresh': session(admin),
      'GET /api/users': { body: { data: [admin] } },
      'POST /api/users': () =>
        ++attempt === 1
          ? {
              status: 409,
              body: {
                error: { code: 'CONFLICT', message: 'A user with this email already exists' },
              },
            }
          : {
              status: 201,
              body: { user: makeUser('cashier', { id: 'new', name: 'Rahul Gowda' }) },
            },
    });
    renderApp('/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Add user' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Rahul Gowda');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'rahul@example.com');
    await userEvent.type(within(dialog).getByLabelText('Temporary password'), 'Cashier2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));

    expect(
      await within(dialog).findByText('A user with this email already exists'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    await vi.waitFor(() => expect(attempt).toBe(2));
    expect(calls.find((c) => c.key === 'POST /api/users')?.body).toEqual({
      name: 'Rahul Gowda',
      email: 'rahul@example.com',
      role: 'cashier',
      password: 'Cashier2026',
    });
  });

  it('checks password strength before sending', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(admin),
      'GET /api/users': { body: { data: [admin] } },
    });
    renderApp('/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Add user' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Temporary password'), 'password');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(
      await within(dialog).findByText('Password must contain a letter and a number'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/users')).toBe(false);
  });

  it('sends only the fields that changed and locks your own role', async () => {
    const calls = mockApi({
      'POST /api/auth/refresh': session(admin),
      'GET /api/users': { body: { data: [admin, cashier] } },
      'PATCH /api/users/cashier-id': { body: { user: { ...cashier, role: 'manager' } } },
    });
    renderApp('/users');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Asha Rao' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Role')).toBeDisabled();
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Edit Priya Nair' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'manager');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.key === 'PATCH /api/users/cashier-id')?.body).toEqual({
        role: 'manager',
      }),
    );
  });
});
