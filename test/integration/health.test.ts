import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestContext } from '../support/context.js';

const harness = createTestHarness();
let ctx: TestContext;

beforeEach(async () => {
  ctx = await harness.setup();
});
afterEach(() => harness.teardown());
afterAll(() => harness.close());

describe('health endpoints', () => {
  it('reports liveness without touching dependencies', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness after checking PostgreSQL', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('answers unknown routes with a problem details 404', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 404,
      code: 'not_found',
      requestId: response.headers['x-request-id'],
    });
  });

  it('reuses a well-formed X-Request-Id and replaces a malformed one', async () => {
    const reused = await ctx.app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'trace-12345678' },
    });
    const replaced = await ctx.app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'bad id <script>' },
    });

    expect(reused.headers['x-request-id']).toBe('trace-12345678');
    expect(replaced.headers['x-request-id']).not.toContain('script');
  });

  it('sends security headers', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health/live' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
