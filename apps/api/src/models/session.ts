import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions } from './common.js';

/**
 * A login session, identified by a refresh token. Only a SHA-256 hash of the token is stored,
 * so a database leak does not leak usable tokens.
 *
 * Refresh tokens are single-use: each refresh revokes the current session and creates its
 * successor in the same `family`. If a revoked token is presented again, someone is replaying
 * a stolen token, and the whole family is revoked.
 */
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: {
      type: String,
      enum: ['rotated', 'logout', 'reuse', 'password_change', 'admin'],
    },
    userAgent: { type: String, maxlength: 300 },
    ip: String,
  },
  baseOptions,
);

sessionSchema.index({ family: 1 });
sessionSchema.index({ user: 1, revokedAt: 1 });
// MongoDB deletes sessions automatically once they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type Session = InferSchemaType<typeof sessionSchema>;
export const SessionModel = model('Session', sessionSchema);
