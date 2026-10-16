import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { LlmFailure, TicketClassifier } from '../../src/llm/classifier.js';
import { FakeLlmProvider, type FakeStep } from '../../src/llm/fake-provider.js';
import { LlmProviderError, type ProviderResponse } from '../../src/llm/types.js';

const ticket = { subject: 'Charged twice', body: 'My card number is 4111... please refund' };

const valid = {
  category: 'billing',
  priority: 'medium',
  sentiment: 'negative',
  summary: 'Customer was charged twice.',
  suggestedReply: 'We are sorry about the duplicate charge and are looking into it.',
};

function reply(text: string, outcome: ProviderResponse['outcome'] = 'completed'): ProviderResponse {
  return {
    text,
    outcome,
    model: 'model-x',
    usage: [
      {
        model: 'model-x',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    ],
  };
}

function classifierWith(script: FakeStep[]) {
  const lines: string[] = [];
  const logger = pino(
    { level: 'debug' },
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
  );
  const provider = new FakeLlmProvider(script);
  return { classifier: new TicketClassifier(provider, logger), provider, logs: lines };
}

async function failureOf(promise: Promise<unknown>): Promise<LlmFailure> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(LlmFailure);
  return error as LlmFailure;
}

describe('TicketClassifier', () => {
  it('returns a validated classification on the first valid answer', async () => {
    const { classifier, provider } = classifierWith([reply(JSON.stringify(valid))]);

    const result = await classifier.classify(ticket);

    expect(result.classification).toEqual(valid);
    expect(result.attempts).toEqual([expect.objectContaining({ attempt: 1, outcome: 'success' })]);
    expect(provider.calls).toHaveLength(1);
  });

  it.each([
    ['not JSON', 'Sure! Here is the classification: billing'],
    ['an unknown category', JSON.stringify({ ...valid, category: 'spam' })],
    ['an extra field', JSON.stringify({ ...valid, internalNotes: 'x' })],
    ['a summary over 280 chars', JSON.stringify({ ...valid, summary: 'x'.repeat(281) })],
    ['a missing field', JSON.stringify({ category: 'billing' })],
  ])('retries once after %s and succeeds', async (_case, invalid) => {
    const { classifier, provider } = classifierWith([reply(invalid), reply(JSON.stringify(valid))]);

    const result = await classifier.classify(ticket);

    expect(result.classification).toEqual(valid);
    expect(result.attempts.map((a) => a.outcome)).toEqual(['invalid_output', 'success']);
    expect(provider.calls).toHaveLength(2);
  });

  it('retries an incomplete (cut off) answer', async () => {
    const { classifier } = classifierWith([
      reply('{"category":"bil', 'incomplete'),
      reply(JSON.stringify(valid)),
    ]);

    await expect(classifier.classify(ticket)).resolves.toMatchObject({ classification: valid });
  });

  it('fails with 502 after the retry, keeping both attempts for billing', async () => {
    const { classifier, provider, logs } = classifierWith([reply('nope'), reply('still nope')]);

    const failure = await failureOf(classifier.classify(ticket));

    expect(failure.statusCode).toBe(502);
    expect(failure.code).toBe('llm_output_invalid');
    expect(failure.attempts.map((a) => a.outcome)).toEqual(['invalid_output', 'invalid_output']);
    expect(failure.attempts.flatMap((a) => a.usage)).toHaveLength(2);
    expect(provider.calls).toHaveLength(2);
    // The event is logged, without the ticket text or the raw model output.
    expect(logs.join('')).toContain('LLM output invalid after retry');
    expect(logs.join('')).not.toContain('4111');
    expect(logs.join('')).not.toContain('still nope');
  });

  it('does not retry a refusal', async () => {
    const { classifier, provider } = classifierWith([reply('', 'refused')]);

    const failure = await failureOf(classifier.classify(ticket));

    expect(failure.code).toBe('llm_refused');
    expect(failure.statusCode).toBe(502);
    expect(provider.calls).toHaveLength(1);
  });

  it.each([
    ['timeout', 504, 'llm_timeout'],
    ['unavailable', 503, 'llm_unavailable'],
    ['upstream', 502, 'llm_upstream_error'],
  ] as const)('maps a provider %s to %i %s', async (kind, status, code) => {
    const { classifier } = classifierWith([new LlmProviderError(kind, 'failed')]);

    const failure = await failureOf(classifier.classify(ticket));

    expect(failure.statusCode).toBe(status);
    expect(failure.code).toBe(code);
    expect(failure.attempts).toEqual([{ attempt: 1, outcome: 'error', usage: [] }]);
  });

  it('treats an unexpected error as an upstream failure', async () => {
    const { classifier } = classifierWith([new TypeError('socket hang up')]);

    expect((await failureOf(classifier.classify(ticket))).code).toBe('llm_upstream_error');
  });
});
