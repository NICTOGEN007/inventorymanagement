import type { SettingsDto, StateCode } from '@ims/shared';
import type { ClientSession } from 'mongoose';
import { SettingsModel } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';

/** The shop's own details. GST calculations depend on its state, so it must exist. */
export async function getShopSettings(session?: ClientSession): Promise<SettingsDto> {
  const s = await SettingsModel.findOne({}, null, { session }).lean();
  if (!s) {
    throw new AppError(
      409,
      'Shop settings are not set up yet (run the seed or add them first)',
      'SETTINGS_MISSING',
    );
  }
  const address = s.address && Object.values(s.address).some(Boolean) ? s.address : undefined;
  return {
    shopName: s.shopName,
    ...(s.legalName && { legalName: s.legalName }),
    gstin: s.gstin,
    stateCode: s.stateCode as StateCode,
    ...(address && {
      address: {
        ...(address.line1 && { line1: address.line1 }),
        ...(address.line2 && { line2: address.line2 }),
        ...(address.city && { city: address.city }),
        ...(address.pincode && { pincode: address.pincode }),
      },
    }),
    ...(s.phone && { phone: s.phone }),
    ...(s.email && { email: s.email }),
    invoicePrefix: s.invoicePrefix ?? 'INV',
    purchaseOrderPrefix: s.purchaseOrderPrefix ?? 'PO',
    returnPrefix: s.returnPrefix ?? 'RET',
    ...(s.invoiceFooter && { invoiceFooter: s.invoiceFooter }),
  };
}
