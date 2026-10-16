import type { Config } from '../config.js';
import { AnthropicLlmProvider } from './anthropic-provider.js';
import { FakeLlmProvider } from './fake-provider.js';
import type { LlmProvider } from './types.js';

export function createLlmProvider(config: Config): LlmProvider {
  switch (config.LLM_PROVIDER) {
    case 'fake':
      return new FakeLlmProvider();
    case 'anthropic':
      if (config.ANTHROPIC_API_KEY === undefined) {
        // Unreachable: configSchema requires the key for this provider.
        throw new Error('ANTHROPIC_API_KEY is required');
      }
      return new AnthropicLlmProvider({
        apiKey: config.ANTHROPIC_API_KEY,
        model: config.LLM_MODEL,
        effort: config.LLM_EFFORT,
        maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS,
        timeoutMs: config.LLM_TIMEOUT_MS,
        maxRetries: config.LLM_MAX_TRANSPORT_RETRIES,
        refusalFallback: config.LLM_REFUSAL_FALLBACK,
      });
  }
}
