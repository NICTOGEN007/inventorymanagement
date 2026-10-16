import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLogModel } from '../models/index.js';
import { logger } from './logger.js';

/**
 * Records who did what. Failures are logged but never break the request:
 * the action itself has already succeeded.
 */
export async function audit(
  req: Request,
  action: string,
  entity: string,
  entityId?: Types.ObjectId | string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await AuditLogModel.create({
      user: req.user?.id,
      action,
      entity,
      entityId,
      details,
      ip: req.ip,
    });
  } catch (err) {
    logger.error({ err, action }, 'Failed to write audit log');
  }
}
