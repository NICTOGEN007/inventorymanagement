import { ROLES } from '@ims/shared';
import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { baseOptions, email } from './common.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { ...email, required: true, unique: true },
    /** bcrypt hash; never returned by queries unless explicitly selected. */
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'cashier' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  baseOptions,
);

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;
export const UserModel = model('User', userSchema);
