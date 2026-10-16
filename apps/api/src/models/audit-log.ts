import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions } from './common.js';

/** Who did what, and when. Written by services for sensitive actions. */
const auditLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    /** Before/after values or other context. */
    details: { type: Schema.Types.Mixed },
    ip: String,
  },
  { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema);
