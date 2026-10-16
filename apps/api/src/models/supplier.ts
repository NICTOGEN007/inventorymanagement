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

const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    contactPerson: { type: String, trim: true },
    phone,
    email,
    gstin,
    stateCode: { ...stateCode, required: true },
    address: addressFields,
    /** Typical days between ordering and receiving goods; used by restock forecasting. */
    leadTimeDays: { type: Number, required: true, min: 0, max: 90, default: 7 },
    isActive: { type: Boolean, default: true },
  },
  baseOptions,
);

supplierSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
supplierSchema.pre('validate', function () {
  gstinMatchesState(this);
});

export type Supplier = InferSchemaType<typeof supplierSchema>;
export const SupplierModel = model('Supplier', supplierSchema);
