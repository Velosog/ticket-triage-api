import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { llmUsage, tickets } from '../../src/db/schema.js';
import { FakeLlmProvider, type FakeStep } from '../../src/llm/fake-provider.js';
import type { ProviderResponse } from '../../src/llm/types.js';
import { usageResponse } from '../../src/modules/usage/usage.schemas.js';
import { createTestHarness, type TestContext } from '../support/context.js';
import { createTestClient, sampleTicket } from '../support/fixtures.js';

const harness = createTestHarness();
let ctx: TestContext;
afterEach(() => harness.teardown());
afterAll(() => harness.close());

// Fixed clock: 2026-10-16 15:00 UTC.
const NOW = new Date('2026-10-16T15:00:00.000Z');

const valid = JSON.stringify({
  category: 'billing',
  priority: 'medium',
  sentiment: 'neutral',
  summary: 'Duplicate charge.',
  suggestedReply: 'We are looking into it.',
});

function billed(
  text: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): ProviderResponse {
  return {
    text,
    outcome: 'completed',
    model,
    usage: [
      { model, inputTokens, outputTokens, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    ],
  };
}

async function setup(script: FakeStep[] = [], budget = 1_000_000) {
  ctx = await harness.setup({}, new FakeLlmProvider(script), () => NOW);
  return createTestClient(ctx.db, { dailyTokenBudget: budget });
}

const postTicket = (headers: Record<string, string>) =>
  ctx.app.inject({ method: 'POST', url: '/v1/tickets', headers, payload: sampleTicket });

describe('usage and cost tracking', () => {
  it('records tokens and estimated cost for every attempt, including the retried one', async () => {
    const { headers } = await setup([
      billed('not json', 'claude-opus-5-5', 1_000, 200), // invalid, retried
      billed(valid, 'claude-opus-5-5', 1_000, 100),
    ]);

    const response = await postTicket(headers);

    expect(response.statusCode).toBe(201);
    const rows = await ctx.db.select().from(llmUsage).orderBy(llmUsage.attempt);
    expect(rows.map((row) => [row.attempt, row.outcome, row.costMicroUsd])).toEqual([
      [1, 'invalid_output', 1_000 * 4 + 200 * 20],
      [2, 'success', 1_000 * 4 + 100 * 20],
    ]);
    // Both rows point at the stored ticket, which totals both attempts.
    const [ticket] = await ctx.db.select().from(tickets);
    expect(rows.every((row) => row.ticketId === ticket?.id)).toBe(true);
    expect(response.json()).toMatchObject({
      usage: { inputTokens: 2_000, outputTokens: 300, costUsd: 0.014 },
    });
  });

  it('records the tokens of a failed classification even though no ticket is stored', async () => {
    const { headers } = await setup([
      billed('nope', 'claude-opus-5-5', 500, 50),
      billed('nope', 'claude-opus-5-5', 500, 50),
    ]);

    expect((await postTicket(headers)).statusCode).toBe(502);

    const rows = await ctx.db.select().from(llmUsage);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.ticketId === null && row.outcome === 'invalid_output')).toBe(
      true,
    );
    expect(await ctx.db.select().from(tickets)).toHaveLength(0);
  });

  it('records each model of a server-side fallback at its own price', async () => {
    const { headers } = await setup([
      {
        text: valid,
        outcome: 'completed',
        model: 'claude-opus-4-8',
        usage: [
          {
            model: 'claude-opus-5-5',
            inputTokens: 1_000,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
          {
            model: 'claude-opus-4-8',
            inputTokens: 1_000,
            outputTokens: 100,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        ],
      },
    ]);

    await postTicket(headers);

    const rows = await ctx.db.select().from(llmUsage);
    expect(rows.map((row) => [row.model, row.costMicroUsd]).sort()).toEqual([
      ['claude-opus-4-8', 1_000 * 5 + 100 * 25],
      ['claude-opus-5-5', 1_000 * 4],
    ]);
  });
});

describe('GET /v1/usage', () => {
  it('reports usage per UTC day with totals and budget status', async () => {
    const { client, headers } = await setup([], 50_000);
    await postTicket(headers);
    await postTicket(headers);
    // Usage from two days earlier, inserted directly.
    await ctx.db.insert(llmUsage).values({
      clientId: client.id,
      requestId: 'older-request',
      provider: 'fake',
      model: 'fake-triage-1',
      attempt: 1,
      outcome: 'success',
      inputTokens: 100,
      outputTokens: 10,
      costMicroUsd: 0,
      createdAt: new Date('2026-10-14T23:59:59.000Z'),
    });

    const response = await ctx.app.inject({ url: '/v1/usage', headers });

    expect(response.statusCode).toBe(200);
    const report = usageResponse.parse(response.json());
    expect(report.from).toBe('2026-10-10');
    expect(report.to).toBe('2026-10-16');
    expect(report.days.map((day) => [day.date, day.requests])).toEqual([
      ['2026-10-14', 1],
      ['2026-10-16', 2],
    ]);
    expect(report.totals.requests).toBe(3);
    expect(report.budget).toMatchObject({
      dailyTokenBudget: 50_000,
      resetsAt: '2026-10-17T00:00:00.000Z',
    });
    // Only today's tokens count against today's budget.
    expect(report.budget.usedToday).toBe(report.days[1]?.totalTokens);
  });

  it('accepts an explicit range and validates it', async () => {
    const { headers } = await setup();

    const ok = await ctx.app.inject({ url: '/v1/usage?from=2026-10-01&to=2026-10-16', headers });
    const reversed = await ctx.app.inject({
      url: '/v1/usage?from=2026-10-16&to=2026-10-01',
      headers,
    });
    const tooLong = await ctx.app.inject({
      url: '/v1/usage?from=2025-01-01&to=2026-10-16',
      headers,
    });
    const notADate = await ctx.app.inject({ url: '/v1/usage?from=yesterday', headers });

    expect(ok.statusCode).toBe(200);
    expect(reversed.statusCode).toBe(400);
    expect(tooLong.json()).toMatchObject({ status: 400, code: 'range_too_large' });
    expect(notADate.statusCode).toBe(400);
  });

  it("never includes another client's usage", async () => {
    const { headers } = await setup();
    await postTicket(headers);
    const other = await createTestClient(ctx.db, { name: 'Other Co' });

    const report = usageResponse.parse(
      (await ctx.app.inject({ url: '/v1/usage', headers: other.headers })).json(),
    );

    expect(report.totals.requests).toBe(0);
  });
});

describe('daily token budget', () => {
  it('answers 429 once the budget is used up, without calling the LLM', async () => {
    const provider = new FakeLlmProvider([billed(valid, 'fake-triage-1', 900, 100)]);
    ctx = await harness.setup({}, provider, () => NOW);
    const { headers } = await createTestClient(ctx.db, { dailyTokenBudget: 1_000 });

    expect((await postTicket(headers)).statusCode).toBe(201);
    const blocked = await postTicket(headers);

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe(String(9 * 3600)); // until 00:00 UTC
    expect(blocked.json()).toMatchObject({
      code: 'daily_token_budget_exceeded',
      budget: { dailyTokenBudget: 1_000, usedToday: 1_000, remainingToday: 0 },
    });
    expect(provider.calls).toHaveLength(1);
  });

  it("does not count yesterday's usage", async () => {
    const { client, headers } = await setup([], 1_000);
    await ctx.db.insert(llmUsage).values({
      clientId: client.id,
      requestId: 'yesterday',
      provider: 'fake',
      model: 'fake-triage-1',
      attempt: 1,
      outcome: 'success',
      inputTokens: 5_000,
      outputTokens: 0,
      costMicroUsd: 0,
      createdAt: new Date('2026-10-15T23:00:00.000Z'),
    });

    expect((await postTicket(headers)).statusCode).toBe(201);
  });

  it('keeps budgets separate per client', async () => {
    const provider = new FakeLlmProvider([billed(valid, 'fake-triage-1', 2_000, 0)]);
    ctx = await harness.setup({}, provider, () => NOW);
    const first = await createTestClient(ctx.db, { dailyTokenBudget: 1_000 });
    const second = await createTestClient(ctx.db, { name: 'Second', dailyTokenBudget: 1_000 });

    await postTicket(first.headers);

    expect((await postTicket(first.headers)).statusCode).toBe(429);
    expect((await postTicket(second.headers)).statusCode).toBe(201);
    const secondUsage = await ctx.db
      .select()
      .from(llmUsage)
      .where(eq(llmUsage.clientId, second.client.id));
    expect(secondUsage).toHaveLength(1);
  });
});
