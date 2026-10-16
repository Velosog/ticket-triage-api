/**
 * Writes the OpenAPI document to docs/openapi.json: `pnpm docs:openapi`.
 * Builds the app with the fake provider and never connects to a database.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { pino } from 'pino';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import { FakeLlmProvider } from '../src/llm/fake-provider.js';

const config = loadConfig({
  NODE_ENV: 'test',
  LLM_PROVIDER: 'fake',
  // pg connects lazily: no query runs, so no database is needed.
  DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
});
const { db, pool } = createDatabase(config.DATABASE_URL, 1);
const app = await buildApp({
  config,
  db,
  logger: pino({ level: 'silent' }),
  llmProvider: new FakeLlmProvider(),
});

await app.ready();
await mkdir('docs', { recursive: true });
await writeFile('docs/openapi.json', `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
await pool.end();

console.log('Wrote docs/openapi.json');
