/** Error thrown for non-2xx API responses, carrying the server's error code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, error?.code ?? 'HTTP_ERROR', error?.message ?? res.statusText);
  }
  return body as T;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: string;
  uptimeSeconds: number;
  timestamp: string;
}
