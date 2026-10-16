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

/** Shop-wide configuration. There is exactly one settings document. */
const settingsSchema = new Schema(
  {
    shopName: { type: String, required: true, trim: true },
    legalName: { type: String, trim: true },
    gstin: { ...gstin, required: true },
    /** The shop's state decides intra-state (CGST+SGST) vs inter-state (IGST) supply. */
    stateCode: { ...stateCode, required: true },
    address: addressFields,
    phone,
    email,
    invoicePrefix: { type: String, default: 'INV', match: /^[A-Z]{1,4}$/ },
    purchaseOrderPrefix: { type: String, default: 'PO', match: /^[A-Z]{1,4}$/ },
    returnPrefix: { type: String, default: 'RET', match: /^[A-Z]{1,4}$/ },
    invoiceFooter: { type: String, trim: true, maxlength: 300 },
  },
  baseOptions,
);

settingsSchema.pre('validate', function () {
  gstinMatchesState(this);
});

export type Settings = InferSchemaType<typeof settingsSchema>;
export const SettingsModel = model('Settings', settingsSchema, 'settings');
