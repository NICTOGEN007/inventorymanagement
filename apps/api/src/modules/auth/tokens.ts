import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@ims/shared';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/app-error.js';

const ISSUER = 'stocksmart-api';
const AUDIENCE = 'stocksmart-web';
const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenClaims {
  userId: string;
  role: Role;
}

export async function signAccessToken(
  { userId, role }: AccessTokenClaims,
  ttlSeconds = env.ACCESS_TOKEN_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

/** Verifies signature, issuer, audience and expiry. Throws a 401 AppError otherwise. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') throw new Error('Missing subject');
    return { userId: payload.sub, role: payload.role as Role };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError(401, 'Your session has expired', 'TOKEN_EXPIRED');
    }
    throw new AppError(401, 'Invalid access token', 'TOKEN_INVALID');
  }
}

/** A refresh token is 256 random bits, sent to the browser only. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
