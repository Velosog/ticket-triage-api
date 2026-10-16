import { Writable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import { FakeLlmProvider } from '../../src/llm/fake-provider.js';
import { createLogger } from '../../src/logger.js';
import { assertTestDatabase, truncateAll } from '../support/database.js';
import { createTestClient, sampleTicket } from '../support/fixtures.js';
import { loadConfig } from '../../src/config.js';

const { db, pool } = createDatabase(assertTestDatabase(process.env.DATABASE_URL), 2);
afterAll(() => pool.end());

describe('request logging', () => {
  it('never writes the API key or the customer email, even at debug level and on errors', async () => {
    await truncateAll(db);
    const lines: string[] = [];
    const logger = createLogger(
      { LOG_LEVEL: 'trace', NODE_ENV: 'test' },
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
    );
    const provider = new FakeLlmProvider([
      new Error('upstream exploded'), // forces the error-logging path once
    ]);
    const app = await buildApp({ config: loadConfig(), db, logger, llmProvider: provider });
    const { apiKey, headers } = await createTestClient(db);

    const failed = await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers,
      payload: sampleTicket,
    });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/tickets',
      headers,
      payload: sampleTicket,
    });
    await app.close();

    expect(failed.statusCode).toBe(502);
    expect(created.statusCode).toBe(201);
    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0);
    expect(output).not.toContain(apiKey);
    expect(output).not.toContain(apiKey.slice(11)); // the secret part after the prefix
    expect(output).not.toContain(sampleTicket.customerEmail);
    expect(output).not.toContain(sampleTicket.body);
    // Logs still identify the caller, by prefix only.
    expect(output).toContain(apiKey.slice(0, 11));
  });
});
