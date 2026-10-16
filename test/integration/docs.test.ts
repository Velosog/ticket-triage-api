import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestContext } from '../support/context.js';

const harness = createTestHarness();
let ctx: TestContext;

beforeEach(async () => {
  ctx = await harness.setup();
});
afterEach(() => harness.teardown());
afterAll(() => harness.close());

interface OpenApiDocument {
  openapi: string;
  info: { version: string };
  paths: Record<
    string,
    Record<string, { security?: unknown[]; responses: Record<string, unknown> }>
  >;
  components: { securitySchemes: Record<string, { type: string; scheme: string }> };
}

describe('OpenAPI documentation', () => {
  it('is generated from the route schemas', async () => {
    const response = await ctx.app.inject({ url: '/docs/json' });

    expect(response.statusCode).toBe(200);
    const doc = response.json<OpenApiDocument>();
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info.version).toBe('0.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/v1/tickets', '/v1/tickets/{id}', '/v1/usage', '/health/ready']),
    );
    expect(Object.keys(doc.paths['/v1/tickets']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '401', '429', '502']),
    );
  });

  it('documents bearer API key auth on every /v1 operation, and only there', async () => {
    const doc = (await ctx.app.inject({ url: '/docs/json' })).json<OpenApiDocument>();

    expect(doc.components.securitySchemes.apiKey).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.paths['/v1/tickets']?.post?.security).toEqual([{ apiKey: [] }]);
    expect(doc.paths['/v1/usage']?.get?.security).toEqual([{ apiKey: [] }]);
    expect(doc.paths['/health/live']?.get?.security).toBeUndefined();
  });

  it('serves the interactive docs page', async () => {
    const response = await ctx.app.inject({ url: '/docs/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });
});
