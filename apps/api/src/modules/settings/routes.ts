import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { getShopSettings } from './service.js';

export const settingsRouter = Router();

/** Everyone signed in needs the shop's details (GST state, invoice header). */
settingsRouter.get('/', authenticate, async (_req, res) => {
  res.json({ settings: await getShopSettings() });
});
