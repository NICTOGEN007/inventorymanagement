import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import '../../src/models/index.js';

/**
 * Connects the test file to a fresh database and builds all indexes.
 * Pass `{ cleanEach: true }` to empty every collection after each test.
 */
export function useTestDatabase({ cleanEach = false } = {}) {
  beforeAll(async () => {
    await mongoose.connect(inject('mongoUri'), { dbName: `test_${randomUUID()}` });
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  });

  if (cleanEach) {
    afterEach(async () => {
      await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})));
    });
  }

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
