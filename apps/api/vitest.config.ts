import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    globalSetup: ['./test/global-setup.ts'],
    // The first run may download a MongoDB binary.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
