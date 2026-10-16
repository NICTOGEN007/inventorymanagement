import { GST_RATES, INDIAN_STATES, isValidGstin } from '@ims/shared';
import mongoose from 'mongoose';

// JSON output for every model: an `id` string instead of `_id`, and no `__v`.
// Set globally because a typed transform in each schema's options defeats Mongoose type inference.
mongoose.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    delete (ret as { _id?: unknown })._id;
    return ret;
  },
});

/** Options shared by every schema: createdAt/updatedAt timestamps and no version key. */
export const baseOptions = { timestamps: true, versionKey: false } as const;

/** Money is always a non-negative whole number of paise. */
export const paise = {
  type: Number,
  required: true,
  min: 0,
  validate: { validator: Number.isInteger, message: '{PATH} must be a whole number of paise' },
} as const;

/** Signed money (e.g. invoice round-off). */
export const signedPaise = {
  type: Number,
  required: true,
  validate: { validator: Number.isInteger, message: '{PATH} must be a whole number of paise' },
} as const;

/** Positive quantity with at most three decimals (grams / millilitres for loose goods). */
export const quantity = {
  type: Number,
  required: true,
  min: [0.001, '{PATH} must be positive'],
  validate: {
    validator: (value: number) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6,
    message: '{PATH} allows at most 3 decimal places',
  },
} as const;

export const gstRate = {
  type: Number,
  required: true,
  enum: { values: [...GST_RATES], message: '{VALUE} is not a valid GST rate' },
} as const;

export const stateCode = {
  type: String,
  enum: { values: INDIAN_STATES.map((s) => s.code), message: '{VALUE} is not a valid state code' },
} as const;

export const gstin = {
  type: String,
  uppercase: true,
  trim: true,
  validate: {
    validator: (value: string | null | undefined) => value == null || isValidGstin(value),
    message: '{VALUE} is not a valid GSTIN',
  },
} as const;

export const addressFields = {
  line1: { type: String, trim: true },
  line2: { type: String, trim: true },
  city: { type: String, trim: true },
  pincode: { type: String, trim: true, match: [/^[1-9][0-9]{5}$/, 'Invalid PIN code'] },
} as const;

export const email = {
  type: String,
  trim: true,
  lowercase: true,
  match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
} as const;

export const phone = {
  type: String,
  trim: true,
  match: [/^[6-9][0-9]{9}$/, 'Phone must be a 10-digit Indian mobile number'],
} as const;

/** The first two digits of a GSTIN are the state code; flags a mismatch on the document. */
export function gstinMatchesState(doc: {
  gstin?: string | null;
  stateCode?: string | null;
  invalidate(path: string, msg: string): void;
}): void {
  if (doc.gstin && doc.stateCode && doc.gstin.slice(0, 2) !== doc.stateCode) {
    doc.invalidate('gstin', 'GSTIN state code does not match the selected state');
  }
}
