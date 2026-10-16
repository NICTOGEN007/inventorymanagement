import { changePasswordSchema, loginSchema, type AuthResponse } from '@ims/shared';
import { Router, type Request, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { UserModel } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { audit } from '../../utils/audit.js';
import { toUserDto } from '../users/dto.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './cookies.js';
import * as auth from './service.js';

const clientInfo = (req: Request): auth.ClientInfo => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
});

function sendSession(res: Response, session: auth.SessionTokens, status = 200) {
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  const body: AuthResponse = {
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    user: session.user,
  };
  res.status(status).json(body);
}

const tooManyAttempts = () =>
  new AppError(
    429,
    'Too many failed sign-in attempts. Please try again in 15 minutes.',
    'RATE_LIMITED',
  );

/** Rate limiters are created per app so tests start from a clean slate. */
export function createAuthRouter() {
  const router = Router();

  // Failed logins only: 10 per account per IP, and 50 per IP across all accounts, per 15 minutes.
  const common = {
    windowMs: 15 * 60_000,
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req: Request, _res: Response, next: (err: unknown) => void) =>
      next(tooManyAttempts()),
  };
  const perAccount = rateLimit({
    ...common,
    limit: 10,
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '')
        .trim()
        .toLowerCase()}`,
  });
  const perIp = rateLimit({ ...common, limit: 50 });

  router.post('/login', perIp, perAccount, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const session = await auth.login(input, clientInfo(req));
    req.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    };
    await audit(req, 'auth.login', 'User', session.user.id);
    sendSession(res, session);
  });

  router.post('/refresh', async (req, res) => {
    try {
      sendSession(res, await auth.refresh(readRefreshCookie(req), clientInfo(req)));
    } catch (err) {
      // A race means a newer cookie is already on its way to the browser: keep it.
      if (!(err instanceof AppError && err.code === 'REFRESH_RACE')) clearRefreshCookie(res);
      throw err;
    }
  });

  router.post('/logout', async (req, res) => {
    await auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
    res.status(204).end();
  });

  router.get('/me', authenticate, async (req, res) => {
    const user = await UserModel.findById(req.user!.id).lean();
    if (!user) throw AppError.unauthorized();
    res.json({ user: toUserDto(user) });
  });

  router.post('/change-password', authenticate, async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const family = await auth.findSessionFamily(readRefreshCookie(req));
    await auth.changePassword(req.user!.id, input, family);
    await audit(req, 'auth.change_password', 'User', req.user!.id);
    res.status(204).end();
  });

  return router;
}
