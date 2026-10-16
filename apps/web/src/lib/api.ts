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
 * Calls the API with the current access token. If the token has expired, renews it once
 * and retries; if that fails, signals that the session is over.
 */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
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
  let data = await parse(res);

  if (
    res.status === 401 &&
    RENEWABLE.has(toApiError(res, data).code) &&
    !path.startsWith('/auth/')
  ) {
    try {
      await refreshSession();
    } catch {
      accessToken = null;
      sessionEvents.dispatchEvent(new Event(SESSION_EXPIRED));
      throw toApiError(res, data);
    }
    res = await send();
    data = await parse(res);
  }

  if (!res.ok) throw toApiError(res, data);
  return data as T;
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
