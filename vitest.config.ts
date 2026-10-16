import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/support/database.js';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one PostgreSQL database and truncate it between
    // tests, so test files run one at a time.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      LLM_PROVIDER: 'fake',
      DATABASE_URL: TEST_DATABASE_URL,
    },
  },
});
