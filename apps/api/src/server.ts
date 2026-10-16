import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDatabase();

  const server = createApp().listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
    // Force exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
