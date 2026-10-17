import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { idParam } from '../../utils/query.js';
import * as forecasting from './service.js';

export const forecastRouter = Router();
forecastRouter.use(authenticate, requirePermission('forecast:read'));

forecastRouter.get('/', async (_req, res) => {
  res.json({ overview: await forecasting.getForecastOverview() });
});

forecastRouter.get('/accuracy', async (_req, res) => {
  res.json({ accuracy: await forecasting.getForecastAccuracy() });
});

forecastRouter.get('/products/:id', async (req, res) => {
  res.json({ forecast: await forecasting.getProductForecast(idParam(req)) });
});
