import { randomUUID } from 'node:crypto';
import type { AuthResponse, ChangePasswordInput, LoginInput } from '@ims/shared';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { SessionModel, UserModel } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { logger } from '../../utils/logger.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { toUserDto } from '../users/dto.js';
import { generateRefreshToken, hashToken, signAccessToken } from './tokens.js';

/** Two tabs refreshing at the same moment both send the same token; the loser may retry. */
const ROTATION_GRACE_MS = 10_000;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface SessionTokens extends AuthResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
  family: string;
}

type SessionUser = Parameters<typeof toUserDto>[0];

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password
// and response times do not reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(randomUUID()));

async function issueTokens(
  user: SessionUser,
  family: string,
  client: ClientInfo,
): Promise<SessionTokens> {
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await SessionModel.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    family,
    expiresAt: refreshExpiresAt,
    ip: client.ip,
    userAgent: client.userAgent?.slice(0, 300),
  });
  return {
    accessToken: await signAccessToken({ userId: String(user._id), role: user.role }),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    user: toUserDto(user),
    refreshToken,
    refreshExpiresAt,
    family,
  };
}

export async function login(input: LoginInput, client: ClientInfo): Promise<SessionTokens> {
  const user = await UserModel.findOne({ email: input.email }).select('+passwordHash');
  const valid = await verifyPassword(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid) {
    throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
  }
  if (!user.isActive) {
    throw new AppError(
      403,
      'Your account has been deactivated. Contact an administrator.',
      'ACCOUNT_INACTIVE',
    );
  }

  user.lastLoginAt = new Date();
  await user.save();
  return issueTokens(user, randomUUID(), client);
}

/**
 * Exchanges a refresh token for a new access token and a new refresh token (rotation).
 * The old refresh token stops working immediately.
 */
export async function refresh(
  refreshToken: string | undefined,
  client: ClientInfo,
): Promise<SessionTokens> {
  if (!refreshToken) throw new AppError(401, 'Not signed in', 'REFRESH_MISSING');
  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  // Atomically claim the token, so two concurrent requests cannot both rotate it.
  const session = await SessionModel.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, revokedReason: 'rotated' } },
  );

  if (!session) {
    const existing = await SessionModel.findOne({ tokenHash }).lean();
    if (!existing || existing.expiresAt <= now) {
      throw new AppError(401, 'Your session has expired. Please sign in again.', 'REFRESH_INVALID');
    }
    if (existing.revokedReason === 'rotated') {
      if (now.getTime() - existing.revokedAt!.getTime() < ROTATION_GRACE_MS) {
        throw new AppError(401, 'Session was just refreshed elsewhere; retry', 'REFRESH_RACE');
      }
      // A rotated token came back long after it was replaced: it was copied. Kill the family.
      await revokeFamily(existing.family, 'reuse');
      logger.warn(
        { userId: String(existing.user), family: existing.family },
        'Refresh token reuse detected',
      );
      throw new AppError(
        401,
        'Your session was ended for security reasons. Please sign in again.',
        'REFRESH_REUSED',
      );
    }
    throw new AppError(401, 'Your session has ended. Please sign in again.', 'REFRESH_INVALID');
  }

  const user = await UserModel.findById(session.user).lean();
  if (!user || !user.isActive) {
    await revokeFamily(session.family, 'admin');
    throw new AppError(401, 'Your account is no longer active', 'ACCOUNT_INACTIVE');
  }
  return issueTokens(user, session.family, client);
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await SessionModel.updateOne(
    { tokenHash: hashToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
  );
}

export async function revokeFamily(family: string, reason: 'reuse' | 'admin'): Promise<void> {
  await SessionModel.updateMany(
    { family, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

/** Ends every session of a user, optionally keeping the one making the request. */
export async function revokeUserSessions(
  userId: Types.ObjectId | string,
  reason: 'password_change' | 'admin',
  keepFamily?: string,
): Promise<number> {
  const result = await SessionModel.updateMany(
    { user: userId, revokedAt: null, ...(keepFamily && { family: { $ne: keepFamily } }) },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return result.modifiedCount;
}

export async function findSessionFamily(
  refreshToken: string | undefined,
): Promise<string | undefined> {
  if (!refreshToken) return undefined;
  const session = await SessionModel.findOne({
    tokenHash: hashToken(refreshToken),
    revokedAt: null,
  }).lean();
  return session?.family;
}

/** Changes the user's own password and signs out their other devices. */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  currentFamily: string | undefined,
): Promise<void> {
  const user = await UserModel.findById(userId).select('+passwordHash');
  if (!user) throw AppError.unauthorized();
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'Your current password is incorrect', 'INVALID_PASSWORD', [
      { path: ['currentPassword'], message: 'Your current password is incorrect' },
    ]);
  }
  user.passwordHash = await hashPassword(input.newPassword);
  await user.save();
  await revokeUserSessions(user._id, 'password_change', currentFamily);
}
