import { defineConfig } from 'vitest/config';

// Needs a disposable Postgres and Redis. The tests wipe the database they connect to,
// so they only run against TEST_DATABASE_URL, never DATABASE_URL.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Set TEST_DATABASE_URL and TEST_REDIS_URL to a disposable Postgres and Redis (see tests/README.md)');
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.TEST_REDIS_URL || 'redis://localhost:6379',
      JWT_SECRET: 'test_access_secret_at_least_32_characters',
      JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_characters',
      FRONTEND_URL: 'http://localhost:3000',
    },
  },
});
