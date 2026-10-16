import type { Config } from '../config.js';
import { FakeLlmProvider } from './fake-provider.js';
import type { LlmProvider } from './types.js';

export function createLlmProvider(config: Config): LlmProvider {
  switch (config.LLM_PROVIDER) {
    case 'fake':
      return new FakeLlmProvider();
    case 'anthropic':
      throw new Error('The Anthropic provider is not available yet');
  }
}
