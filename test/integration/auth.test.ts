import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clients } from '../../src/db/schema.js';
import { generateApiKey } from '../../src/modules/clients/api-keys.js';
import { createTestHarness, type TestContext } from '../support/context.js';
import { createTestClient } from '../support/fixtures.js';

const harness = createTestHarness();
let ctx: TestContext;

beforeEach(async () => {
  ctx = await harness.setup();
});
afterEach(() => harness.teardown());
afterAll(() => harness.close());

const listTickets = (headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url: '/v1/tickets', headers });

describe('API key authentication', () => {
  it('accepts a valid key', async () => {
    const { headers } = await createTestClient(ctx.db);

    expect((await listTickets(headers)).statusCode).toBe(200);
  });

  it.each([
    ['no header', {}],
    ['wrong scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['malformed key', { authorization: 'Bearer not-a-key' }],
    ['unknown key', { authorization: `Bearer ${generateApiKey()}` }],
  ])('rejects %s with 401 problem details', async (_case, headers) => {
    const response = await listTickets(headers);

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toMatchObject({ status: 401, code: 'unauthenticated' });
  });

  it('rejects the key of a deactivated client', async () => {
    const { client, headers } = await createTestClient(ctx.db);
    await ctx.db.update(clients).set({ isActive: false }).where(eq(clients.id, client.id));

    expect((await listTickets(headers)).statusCode).toBe(401);
  });

  it('stores only a hash of the key', async () => {
    const { client, apiKey } = await createTestClient(ctx.db);
    const [row] = await ctx.db.select().from(clients).where(eq(clients.id, client.id));

    expect(row?.apiKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(apiKey);
    expect(row?.apiKeyPrefix).toBe(apiKey.slice(0, 11));
  });

  it('leaves health endpoints public', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
  });
});
