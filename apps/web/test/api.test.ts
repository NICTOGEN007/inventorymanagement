import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFetch,
  fieldErrors,
  SESSION_EXPIRED,
  sessionEvents,
  setAccessToken,
} from '@/lib/api';
import { makeUser, mockApi, session } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

const expired = { status: 401, body: { error: { code: 'TOKEN_EXPIRED', message: 'expired' } } };

describe('apiFetch', () => {
  it('renews an expired token once and retries the request', async () => {
    setAccessToken('old');
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('admin')),
      'GET /api/products': ({ headers }) =>
        headers.Authorization === 'Bearer token-for-admin-id' ? { body: { ok: true } } : expired,
    });
    await expect(apiFetch('/products')).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.key)).toEqual([
      'GET /api/products',
      'POST /api/auth/refresh',
      'GET /api/products',
    ]);
  });

  it('shares one renewal between concurrent requests', async () => {
    setAccessToken('old');
    const calls = mockApi({
      'POST /api/auth/refresh': session(makeUser('admin')),
      'GET /api/a': ({ headers }) =>
        headers.Authorization?.includes('token-for') ? { body: 'a' } : expired,
      'GET /api/b': ({ headers }) =>
        headers.Authorization?.includes('token-for') ? { body: 'b' } : expired,
    });
    await expect(Promise.all([apiFetch('/a'), apiFetch('/b')])).resolves.toEqual(['a', 'b']);
    expect(calls.filter((c) => c.key === 'POST /api/auth/refresh')).toHaveLength(1);
  });

  it('retries once when another tab refreshed at the same moment', async () => {
    let attempt = 0;
    mockApi({
      'POST /api/auth/refresh': () =>
        ++attempt === 1
          ? { status: 401, body: { error: { code: 'REFRESH_RACE', message: 'retry' } } }
          : session(makeUser('admin')),
      'GET /api/x': ({ headers }) => (headers.Authorization ? { body: 1 } : expired),
    });
    await expect(apiFetch('/x')).resolves.toBe(1);
    expect(attempt).toBe(2);
  });

  it('announces the end of the session when renewal fails', async () => {
    mockApi({
      'POST /api/auth/refresh': {
        status: 401,
        body: { error: { code: 'REFRESH_INVALID', message: 'gone' } },
      },
      'GET /api/x': expired,
    });
    const listener = vi.fn();
    sessionEvents.addEventListener(SESSION_EXPIRED, listener);
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 401, code: 'TOKEN_EXPIRED' });
    expect(listener).toHaveBeenCalledOnce();
    sessionEvents.removeEventListener(SESSION_EXPIRED, listener);
  });

  it('does not try to renew on other errors', async () => {
    const calls = mockApi({
      'GET /api/x': { status: 403, body: { error: { code: 'FORBIDDEN', message: 'no' } } },
    });
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it('sends JSON bodies and handles empty responses', async () => {
    const calls = mockApi({ 'POST /api/thing': { status: 204 } });
    await expect(apiFetch('/thing', { method: 'POST', body: { a: 1 } })).resolves.toBeUndefined();
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.body).toEqual({ a: 1 });
  });
});

describe('fieldErrors', () => {
  it('maps validation issues to form fields', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'Invalid', [
      { path: ['email'], message: 'Bad email' },
      { path: ['email'], message: 'Second message ignored' },
      { path: ['password'], message: 'Too short' },
    ]);
    expect(fieldErrors(error)).toEqual({ email: 'Bad email', password: 'Too short' });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
});
