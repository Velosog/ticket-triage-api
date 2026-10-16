import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestContext } from '../support/context.js';
import { createTestClient } from '../support/fixtures.js';

const harness = createTestHarness({ RATE_LIMIT_PER_MINUTE: 2 });
let ctx: TestContext;

beforeEach(async () => {
  ctx = await harness.setup();
});
afterEach(() => harness.teardown());
afterAll(() => harness.close());

describe('rate limiting per API key', () => {
  it('answers 429 with Retry-After once the limit is reached', async () => {
    const { headers } = await createTestClient(ctx.db);
    const list = () => ctx.app.inject({ url: '/v1/tickets', headers });

    expect((await list()).statusCode).toBe(200);
    expect((await list()).statusCode).toBe(200);
    const limited = await list();

    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json()).toMatchObject({ status: 429, code: 'rate_limited', limit: 2 });
  });

  it('keeps a separate bucket for each key', async () => {
    const first = await createTestClient(ctx.db, { name: 'First' });
    const second = await createTestClient(ctx.db, { name: 'Second' });

    for (let i = 0; i < 2; i++) {
      await ctx.app.inject({ url: '/v1/tickets', headers: first.headers });
    }

    expect((await ctx.app.inject({ url: '/v1/tickets', headers: first.headers })).statusCode).toBe(
      429,
    );
    expect((await ctx.app.inject({ url: '/v1/tickets', headers: second.headers })).statusCode).toBe(
      200,
    );
  });
});
