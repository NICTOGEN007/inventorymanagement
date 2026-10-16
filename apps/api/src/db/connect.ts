import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let closing = false;

export async function connectDatabase(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  closing = false;
  mongoose.set('strictQuery', true);
  mongoose.connection.on('disconnected', () => {
    if (!closing) logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  const connection = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info({ host: connection.connection.host }, 'MongoDB connected');
  return connection;
}

export async function disconnectDatabase(): Promise<void> {
  closing = true;
  await mongoose.disconnect();
}

/** Human-readable connection state: 'connected', 'disconnected', 'connecting', ... */
export function databaseStatus(): string {
  return mongoose.STATES[mongoose.connection.readyState] ?? 'unknown';
}
