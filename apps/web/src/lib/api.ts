import type { ApiErrorBody, AuthResponse } from '@ims/shared';

/** Error thrown for non-2xx API responses, carrying the server's error code and details. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

// The access token lives only in memory: a page reload restores it from the refresh cookie,
// and no script can find it in localStorage.
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Fired when the session cannot be renewed; the auth provider then shows the login page. */
export const sessionEvents = new EventTarget();
export const SESSION_EXPIRED = 'session-expired';

async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  return res.json().catch(() => undefined);
}

function toApiError(res: Response, body: unknown): ApiError {
  const error = (body as ApiErrorBody | undefined)?.error;
  return new ApiError(
    res.status,
    error?.code ?? 'HTTP_ERROR',
    error?.message ?? (res.statusText || 'Request failed'),
    error?.details,
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestRefresh(retryOnRace: boolean): Promise<AuthResponse> {
  const res = await fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  const body = await parse(res);
  if (!res.ok) {
    const error = toApiError(res, body);
    // Another tab refreshed at the same moment; its new cookie is now ours, so try once more.
    if (error.code === 'REFRESH_RACE' && retryOnRace) {
      await delay(250);
      return requestRefresh(false);
    }
    throw error;
  }
  const session = body as AuthResponse;
  accessToken = session.accessToken;
  return session;
}

let refreshing: Promise<AuthResponse> | null = null;

/** Renews the session from the refresh cookie. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthResponse> {
  refreshing ??= requestRefresh(true).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

const RENEWABLE = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHORIZED']);

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  /** Sent as JSON. */
  body?: unknown;
}

/**
 * Sends a request with the current access token. If the token has expired, renews it once and
 * retries; if that fails, signals that the session is over.
 */
async function authorizedFetch(
  path: string,
  options: ApiOptions = {},
): Promise<{ res: Response; data?: unknown }> {
  const { body, headers, ...init } = options;
  const send = () =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  let res = await send();
  if (res.status !== 401 || path.startsWith('/auth/')) return { res };
  const data = await parse(res);
  if (!RENEWABLE.has(toApiError(res, data).code)) return { res, data };
  try {
    await refreshSession();
  } catch {
    accessToken = null;
    sessionEvents.dispatchEvent(new Event(SESSION_EXPIRED));
    throw toApiError(res, data);
  }
  res = await send();
  return { res };
}

/** Calls the API and returns the JSON response, throwing an ApiError for non-2xx answers. */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const result = await authorizedFetch(path, options);
  const data = 'data' in result ? result.data : await parse(result.res);
  if (!result.res.ok) throw toApiError(result.res, data);
  return data as T;
}

/** Downloads a file (such as an invoice PDF) from the API with the user's credentials. */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const result = await authorizedFetch(path);
  if (!result.res.ok) {
    throw toApiError(result.res, 'data' in result ? result.data : await parse(result.res));
  }
  return result.res.blob();
}

/** Field errors from a server validation response, keyed by the first path segment. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const issue of error.details as { path?: unknown[]; message?: string }[]) {
    const key = issue.path?.[0];
    if (typeof key === 'string' && issue.message && !out[key]) out[key] = issue.message;
  }
  return out;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: string;
  uptimeSeconds: number;
  timestamp: string;
}
