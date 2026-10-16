import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../../src/llm/fake-provider.js';
import { ticketListResponse, ticketResponse } from '../../src/modules/tickets/tickets.schemas.js';
import { createTestHarness, type TestContext } from '../support/context.js';
import { createTestClient, sampleTicket } from '../support/fixtures.js';

const harness = createTestHarness();
let ctx: TestContext;
let provider: FakeLlmProvider;
let headers: { authorization: string };

beforeEach(async () => {
  provider = new FakeLlmProvider();
  ctx = await harness.setup({}, provider);
  ({ headers } = await createTestClient(ctx.db));
});
afterEach(() => harness.teardown());
afterAll(() => harness.close());

const createTicket = (payload: object, auth = headers) =>
  ctx.app.inject({ method: 'POST', url: '/v1/tickets', headers: auth, payload });

describe('POST /v1/tickets', () => {
  it('classifies and stores the ticket', async () => {
    const response = await createTicket(sampleTicket);

    expect(response.statusCode).toBe(201);
    const ticket = ticketResponse.parse(response.json());
    expect(ticket).toMatchObject({
      subject: sampleTicket.subject,
      customerEmail: sampleTicket.customerEmail,
      category: 'billing',
      llm: { provider: 'fake', model: 'fake-triage-1', promptVersion: 'triage-v1' },
    });
    expect(ticket.summary.length).toBeLessThanOrEqual(280);
    expect(ticket.usage.inputTokens).toBeGreaterThan(0);
  });

  it('never sends the customer email to the LLM', async () => {
    await createTicket(sampleTicket);

    expect(provider.calls).toEqual([{ subject: sampleTicket.subject, body: sampleTicket.body }]);
    expect(JSON.stringify(provider.calls)).not.toContain(sampleTicket.customerEmail);
  });

  it.each([
    ['missing fields', {}],
    ['invalid email', { ...sampleTicket, customerEmail: 'not-an-email' }],
    ['blank subject', { ...sampleTicket, subject: '   ' }],
    ['body too long', { ...sampleTicket, body: 'x'.repeat(10_001) }],
    ['unknown field', { ...sampleTicket, priority: 'urgent' }],
  ])('rejects %s with 400 and does not call the LLM', async (_case, payload) => {
    const response = await createTicket(payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
    expect(provider.calls).toHaveLength(0);
  });

  it('answers 502 when the model output is not a valid classification', async () => {
    provider = new FakeLlmProvider([
      { text: '{"category":"spam"}', outcome: 'completed', model: 'fake-triage-1', usage: [] },
      { text: '{"category":"spam"}', outcome: 'completed', model: 'fake-triage-1', usage: [] },
    ]);
    await harness.teardown();
    ctx = await harness.setup({}, provider);
    ({ headers } = await createTestClient(ctx.db));

    const response = await createTicket(sampleTicket);

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 'llm_output_invalid' });
  });
});

describe('GET /v1/tickets/:id', () => {
  it('returns a ticket of the authenticated client', async () => {
    const created = ticketResponse.parse((await createTicket(sampleTicket)).json());

    const response = await ctx.app.inject({ url: `/v1/tickets/${created.id}`, headers });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(created);
  });

  it("answers 404 for another client's ticket (no cross-tenant access)", async () => {
    const created = ticketResponse.parse((await createTicket(sampleTicket)).json());
    const other = await createTestClient(ctx.db, { name: 'Other Co' });

    const response = await ctx.app.inject({
      url: `/v1/tickets/${created.id}`,
      headers: other.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    expect((await ctx.app.inject({ url: `/v1/tickets/${randomUUID()}`, headers })).statusCode).toBe(
      404,
    );
    expect((await ctx.app.inject({ url: '/v1/tickets/123', headers })).statusCode).toBe(400);
  });
});

describe('GET /v1/tickets', () => {
  beforeEach(async () => {
    await createTicket(sampleTicket); // billing
    await createTicket({ ...sampleTicket, subject: 'Cannot log in', body: 'Password reset fails' }); // account
    await createTicket({ ...sampleTicket, subject: 'Site is down', body: 'Production outage!' }); // technical, urgent
  });

  it('paginates newest first', async () => {
    const page1 = ticketListResponse.parse(
      (await ctx.app.inject({ url: '/v1/tickets?pageSize=2', headers })).json(),
    );
    const page2 = ticketListResponse.parse(
      (await ctx.app.inject({ url: '/v1/tickets?pageSize=2&page=2', headers })).json(),
    );

    expect(page1.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(page1.data.map((t) => t.subject)).toEqual(['Site is down', 'Cannot log in']);
    expect(page2.data.map((t) => t.subject)).toEqual([sampleTicket.subject]);
  });

  it('filters by category and priority', async () => {
    const byCategory = ticketListResponse.parse(
      (await ctx.app.inject({ url: '/v1/tickets?category=account', headers })).json(),
    );
    const byPriority = ticketListResponse.parse(
      (await ctx.app.inject({ url: '/v1/tickets?priority=urgent', headers })).json(),
    );

    expect(byCategory.data.map((t) => t.subject)).toEqual(['Cannot log in']);
    expect(byPriority.data.map((t) => t.subject)).toEqual(['Site is down']);
  });

  it("never lists another client's tickets", async () => {
    const other = await createTestClient(ctx.db, { name: 'Other Co' });

    const response = await ctx.app.inject({ url: '/v1/tickets', headers: other.headers });

    expect(ticketListResponse.parse(response.json()).pagination.total).toBe(0);
  });

  it('validates query parameters', async () => {
    const response = await ctx.app.inject({ url: '/v1/tickets?pageSize=500', headers });

    expect(response.statusCode).toBe(400);
  });
});
