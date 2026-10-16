import { pino } from 'pino';
import { buildApp } from '../../src/app.js';
import { type Config, loadConfig } from '../../src/config.js';
import { createDatabase, type Database, type DatabaseHandle } from '../../src/db/client.js';
import type { AppInstance } from '../../src/http/types.js';
import { FakeLlmProvider } from '../../src/llm/fake-provider.js';
import type { LlmProvider } from '../../src/llm/types.js';
import { assertTestDatabase, truncateAll } from './database.js';

export interface TestContext {
  app: AppInstance;
  db: Database;
  config: Config;
}

/**
 * One database pool per test file; a fresh app (and empty tables) per test.
 * Call setup() in beforeEach, teardown() in afterEach and close() in afterAll.
 */
export function createTestHarness(overrides: Partial<Config> = {}) {
  let handle: DatabaseHandle | undefined;
  let current: TestContext | undefined;

  return {
    async setup(
      extra: Partial<Config> = {},
      llmProvider: LlmProvider = new FakeLlmProvider(),
      now?: () => Date,
    ): Promise<TestContext> {
      const config = { ...loadConfig(), ...overrides, ...extra };
      handle ??= createDatabase(assertTestDatabase(config.DATABASE_URL), 5);
      await truncateAll(handle.db);
      const app = await buildApp({
        config,
        db: handle.db,
        logger: pino({ level: 'silent' }),
        llmProvider,
        ...(now === undefined ? {} : { now }),
      });
      current = { app, db: handle.db, config };
      return current;
    },
    async teardown(): Promise<void> {
      await current?.app.close();
      current = undefined;
    },
    async close(): Promise<void> {
      await handle?.pool.end();
      handle = undefined;
    },
  };
}
