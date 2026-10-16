import { describe, expect, it } from 'vitest';
import { parseClassification } from '../../src/llm/classification.js';
import { FakeLlmProvider, heuristicClassification } from '../../src/llm/fake-provider.js';

describe('FakeLlmProvider', () => {
  it.each([
    ['Charged twice', 'I need a refund for a duplicate charge', 'billing'],
    ['Cannot log in', 'My password reset email never arrives', 'account'],
    ['API errors', 'The export endpoint fails with error 500', 'technical'],
    ['Office hours', 'What time do you open on Saturdays?', 'other'],
  ])('classifies "%s" as %s', (subject, body, category) => {
    expect(heuristicClassification({ subject, body }).category).toBe(category);
  });

  it('derives priority and sentiment from the text', () => {
    const result = heuristicClassification({
      subject: 'Production is down',
      body: 'This outage is unacceptable, we are losing sales!',
    });

    expect(result.priority).toBe('urgent');
    expect(result.sentiment).toBe('negative');
  });

  it('is deterministic and its output passes the classification schema', async () => {
    const provider = new FakeLlmProvider();
    const ticket = { subject: 'Invoice question', body: 'Thanks! Where can I download invoices?' };

    const first = await provider.classify(ticket);
    const second = await provider.classify(ticket);

    expect(first).toEqual(second);
    expect(parseClassification(first.text).success).toBe(true);
    expect(first.usage[0]?.inputTokens).toBeGreaterThan(0);
  });

  it('plays scripted steps before falling back to heuristics', async () => {
    const provider = new FakeLlmProvider([
      { text: 'not json', outcome: 'completed', model: 'scripted', usage: [] },
      new Error('boom'),
    ]);
    const ticket = { subject: 's', body: 'b' };

    await expect(provider.classify(ticket)).resolves.toMatchObject({ text: 'not json' });
    await expect(provider.classify(ticket)).rejects.toThrow('boom');
    await expect(provider.classify(ticket)).resolves.toMatchObject({ outcome: 'completed' });
    expect(provider.calls).toHaveLength(3);
  });
});
