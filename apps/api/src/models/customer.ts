import { model, Schema, type InferSchemaType } from 'mongoose';
import {
  addressFields,
  baseOptions,
  email,
  gstin,
  gstinMatchesState,
  phone,
  stateCode,
} from './common.js';

const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone,
    email,
    /** Business customers provide a GSTIN to claim input tax credit (B2B invoice). */
    gstin,
    /** Place of supply; defaults to the shop's state when not set. */
    stateCode,
    address: addressFields,
    isActive: { type: Boolean, default: true },
  },
  baseOptions,
);

customerSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
customerSchema.index({ name: 'text', phone: 'text' });
customerSchema.pre('validate', function () {
  gstinMatchesState(this);
});

export type Customer = InferSchemaType<typeof customerSchema>;
export const CustomerModel = model('Customer', customerSchema);
