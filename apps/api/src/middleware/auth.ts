import { can, type Permission } from '@ims/shared';
import type { RequestHandler } from 'express';
import { isValidObjectId } from 'mongoose';
import { UserModel } from '../models/index.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { AppError } from '../utils/app-error.js';

/**
 * Requires a valid `Authorization: Bearer <access token>` header.
 *
 * The user is re-loaded on every request, so deactivating an account or changing a role
 * takes effect immediately rather than when the token expires.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();

  const { userId } = await verifyAccessToken(header.slice('Bearer '.length).trim());
  const user = isValidObjectId(userId) ? await UserModel.findById(userId).lean() : null;
  if (!user || !user.isActive) {
    throw new AppError(401, 'Your account is no longer active', 'ACCOUNT_INACTIVE');
  }

  req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role };
  next();
};

/** Allows the request only if the signed-in user's role has every listed permission. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) throw AppError.unauthorized();
    if (!permissions.every((p) => can(req.user!.role, p))) throw AppError.forbidden();
    next();
  };
}
