import type { Request, Response } from 'express';
import { env } from '../../config/env.js';

export const REFRESH_COOKIE = 'ims_refresh';
// The cookie is only ever sent to the auth endpoints, not with every API call.
const COOKIE_PATH = '/api/auth';

export function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: COOKIE_PATH,
    expires,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: COOKIE_PATH,
  });
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
