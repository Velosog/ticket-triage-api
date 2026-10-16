import type { TokenUsage } from './types.js';

/** Prices in USD per million tokens. */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * The single source of truth for model prices (Anthropic first-party API list
 * prices, checked 2026-10-16: https://platform.claude.com/docs/en/about-claude/pricing).
 * Update this table when prices change; nothing else in the code knows a price.
 *
 * Cache writes are priced at 1.25x input (5-minute cache) and cache reads at
 * the published rate where known, else 0.1x input. This service does not use
 * prompt caching today, so those fields normally multiply zero.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  // Haiku 5.5 rates apply to prompts up to 100K tokens (tickets are capped far below).
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // The offline fake provider is free.
  'fake-triage-1': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/**
 * A model we have no price for (e.g. a new server-side fallback target) is
 * charged at the most expensive known rate, so cost and budgets are never
 * under-reported. Callers log a warning so the table gets updated.
 */
const MOST_EXPENSIVE: ModelPricing = Object.values(MODEL_PRICING).reduce((max, price) =>
  price.output > max.output ? price : max,
);

export function hasPricing(model: string): boolean {
  return Object.hasOwn(MODEL_PRICING, model);
}

export function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? MOST_EXPENSIVE;
}

/**
 * Cost in micro-dollars (1 USD = 1_000_000). Since prices are "USD per
 * million tokens", tokens x price is already micro-dollars; each attempt is
 * rounded up so fractions of a micro-dollar are never lost.
 */
export function costMicroUsd(usage: TokenUsage): number {
  const price = pricingFor(usage.model);
  return Math.ceil(
    usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.cacheCreationInputTokens * price.cacheWrite,
  );
}
