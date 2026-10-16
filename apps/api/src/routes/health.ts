import { Router } from 'express';
import { databaseStatus } from '../db/connect.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const database = databaseStatus();
  res.status(database === 'connected' ? 200 : 503).json({
    status: database === 'connected' ? 'ok' : 'degraded',
    database,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
