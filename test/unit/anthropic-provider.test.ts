import { afterEach, describe, expect, it } from 'vitest';
import {
  AnthropicLlmProvider,
  type AnthropicProviderOptions,
} from '../../src/llm/anthropic-provider.js';
import { classificationJsonSchema } from '../../src/llm/classification.js';
import { SYSTEM_PROMPT } from '../../src/llm/prompt.js';
import { LlmProviderError } from '../../src/llm/types.js';
import {
  messageBody,
  startStubAnthropic,
  type StubReply,
} from '../support/stub-anthropic-server.js';

const ticket = { subject: 'Charged twice', body: 'Please refund the duplicate charge.' };

let stub: Awaited<ReturnType<typeof startStubAnthropic>> | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

async function providerWith(
  reply: (attempt: number) => StubReply,
  options: Partial<AnthropicProviderOptions> = {},
) {
  let attempt = 0;
  stub = await startStubAnthropic(() => reply(++attempt));
  const provider = new AnthropicLlmProvider({
    apiKey: 'test-key-not-real',
    model: 'claude-opus-5-5',
    effort: 'low',
    maxOutputTokens: 1024,
    timeoutMs: 2_000,
    maxRetries: 0,
    refusalFallback: true,
    baseURL: stub.url,
    ...options,
  });
  return { provider, requests: stub.requests };
}

describe('AnthropicLlmProvider request', () => {
  it('sends one structured-output request with no tools', async () => {
    const { provider, requests } = await providerWith(() => ({ status: 200, body: messageBody() }));

    await provider.classify(ticket);

    expect(requests).toHaveLength(1);
    const body = requests[0]?.body ?? {};
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    // The model can only answer: it is given no tools to call.
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(requests[0]?.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
  });

  it('constrains the output to a closed JSON schema', async () => {
    const { provider, requests } = await providerWith(() => ({ status: 200, body: messageBody() }));

    await provider.classify(ticket);

    const schema = (
      requests[0]?.body.output_config as { format: { schema: Record<string, unknown> } }
    ).format.schema;
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(schema.required).toEqual(
      expect.arrayContaining(['category', 'priority', 'sentiment', 'summary', 'suggestedReply']),
    );
  });

  it('sends the ticket only inside the delimited user message', async () => {
    const { provider, requests } = await providerWith(() => ({ status: 200, body: messageBody() }));

    await provider.classify(ticket);

    const messages = requests[0]?.body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toContain('<ticket>');
    expect(messages[0]?.content).toContain(ticket.body);
    expect(SYSTEM_PROMPT).not.toContain(ticket.body);
  });

  it('can turn the refusal fallback off', async () => {
    const { provider, requests } = await providerWith(
      () => ({ status: 200, body: messageBody() }),
      {
        refusalFallback: false,
      },
    );

    await provider.classify(ticket);

    expect(requests[0]?.body).not.toHaveProperty('fallbacks');
  });
});

describe('AnthropicLlmProvider response', () => {
  it('returns the text output, outcome, model and usage', async () => {
    const { provider } = await providerWith(() => ({ status: 200, body: messageBody() }));

    const response = await provider.classify(ticket);

    expect(response.outcome).toBe('completed');
    expect(JSON.parse(response.text)).toMatchObject({ category: 'billing' });
    expect(response.usage).toEqual([
      {
        model: 'claude-opus-5-5',
        inputTokens: 812,
        outputTokens: 95,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    ]);
  });

  it('reports every billed attempt after a server-side fallback', async () => {
    const { provider } = await providerWith(() => ({
      status: 200,
      body: messageBody({
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 800,
          output_tokens: 90,
          iterations: [
            {
              type: 'message',
              model: 'claude-opus-5-5',
              input_tokens: 800,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_creation: null,
            },
            {
              type: 'fallback_message',
              model: 'claude-opus-4-8',
              input_tokens: 800,
              output_tokens: 90,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_creation: null,
            },
          ],
        },
      }),
    }));

    const response = await provider.classify(ticket);

    expect(response.model).toBe('claude-opus-4-8');
    expect(response.usage.map((usage) => [usage.model, usage.outputTokens])).toEqual([
      ['claude-opus-5-5', 0],
      ['claude-opus-4-8', 90],
    ]);
  });

  it.each([
    ['refusal', 'refused'],
    ['max_tokens', 'incomplete'],
    ['end_turn', 'completed'],
  ])('maps stop_reason %s to %s', async (stopReason, outcome) => {
    const { provider } = await providerWith(() => ({
      status: 200,
      body: messageBody({ stop_reason: stopReason }),
    }));

    expect((await provider.classify(ticket)).outcome).toBe(outcome);
  });
});

describe('AnthropicLlmProvider errors', () => {
  it('enforces the request timeout', async () => {
    const { provider } = await providerWith(() => ({ hang: true }), { timeoutMs: 300 });
    const started = Date.now();

    const error = await provider.classify(ticket).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it.each([
    [429, 'unavailable'],
    [529, 'unavailable'],
    [500, 'unavailable'],
    [401, 'upstream'],
    [400, 'upstream'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const { provider } = await providerWith(() => ({
      status,
      body: { type: 'error', error: { type: 'some_error', message: 'details' } },
    }));

    const error = await provider.classify(ticket).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(kind);
  });

  it('lets the SDK retry transient failures before giving up', async () => {
    const { provider, requests } = await providerWith(
      (attempt) =>
        attempt === 1 ? { status: 529, body: {} } : { status: 200, body: messageBody() },
      { maxRetries: 1 },
    );

    const response = await provider.classify(ticket);

    expect(response.outcome).toBe('completed');
    expect(requests).toHaveLength(2);
  });
});

describe('structured output schema', () => {
  it('keeps enums and closes the object, but drops keywords the API rejects', () => {
    const schema = classificationJsonSchema();
    const properties = schema.properties as Record<string, Record<string, unknown>>;

    expect(schema.additionalProperties).toBe(false);
    expect(properties.category?.enum).toEqual(['billing', 'technical', 'account', 'other']);
    expect(properties.priority?.enum).toEqual(['low', 'medium', 'high', 'urgent']);
    expect(properties.sentiment?.enum).toEqual(['negative', 'neutral', 'positive']);
    expect(JSON.stringify(schema)).not.toMatch(/minLength|maxLength|\$schema/);
  });
});
