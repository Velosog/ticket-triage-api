import { describe, expect, it } from 'vitest';
import { costMicroUsd, hasPricing, MODEL_PRICING, pricingFor } from '../../src/llm/pricing.js';

const usage = (model: string, inputTokens: number, outputTokens: number) => ({
  model,
  inputTokens,
  outputTokens,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
});

describe('pricing', () => {
  it('computes cost in integer micro-dollars from USD per million tokens', () => {
    // claude-opus-5-5: $4 / MTok input, $20 / MTok output.
    // 1_000 input tokens = $0.004 = 4_000 micro-USD; 500 output = $0.01 = 10_000.
    expect(costMicroUsd(usage('claude-opus-5-5', 1_000, 500))).toBe(14_000);
  });

  it('rounds fractions of a micro-dollar up, never down', () => {
    // claude-haiku-5-5: $0.10 / MTok input -> 3 tokens = 0.3 micro-USD.
    expect(costMicroUsd(usage('claude-haiku-5-5', 3, 0))).toBe(1);
  });

  it('prices cache reads and writes separately', () => {
    const cost = costMicroUsd({
      model: 'claude-opus-5-5',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 1_000,
      cacheCreationInputTokens: 1_000,
    });

    expect(cost).toBe(1_000 * 0.2 + 1_000 * 5);
  });

  it('charges an unknown model at the most expensive known rate', () => {
    expect(hasPricing('claude-future-9')).toBe(false);
    const max = Math.max(...Object.values(MODEL_PRICING).map((price) => price.output));

    expect(pricingFor('claude-future-9').output).toBe(max);
  });

  it('makes the offline fake provider free', () => {
    expect(costMicroUsd(usage('fake-triage-1', 10_000, 10_000))).toBe(0);
  });
});
