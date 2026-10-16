import Anthropic from '@anthropic-ai/sdk';
import { classificationJsonSchema } from './classification.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { REFUSAL_FALLBACK_BETA } from './refusal-fallback.js';
import {
  type LlmProvider,
  LlmProviderError,
  type ProviderOutcome,
  type ProviderResponse,
  type TicketText,
  type TokenUsage,
} from './types.js';

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The one SDK method this adapter needs; tests inject a stub. */
export interface BetaMessagesApi {
  create(params: CreateParams): PromiseLike<BetaMessage>;
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  refusalFallback: boolean;
  /** Override the API endpoint (an internal gateway, or a local stub in tests). */
  baseURL?: string;
}

/** Structured-output schema (enums enforced by the API, lengths by Zod). */
const OUTPUT_SCHEMA = classificationJsonSchema();

/**
 * Claude adapter (official @anthropic-ai/sdk). Single request, no tools:
 * the model can only answer, never act. The SDK enforces the timeout and
 * retries transient failures (429, 5xx, connection errors).
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly messages: BetaMessagesApi;

  constructor(
    private readonly options: AnthropicProviderOptions,
    messages?: BetaMessagesApi,
  ) {
    this.model = options.model;
    this.messages =
      messages ??
      new Anthropic({
        apiKey: options.apiKey,
        timeout: options.timeoutMs,
        maxRetries: options.maxRetries,
        ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
      }).beta.messages;
  }

  async classify(ticket: TicketText): Promise<ProviderResponse> {
    let message: BetaMessage;
    try {
      message = await this.messages.create({
        model: this.options.model,
        max_tokens: this.options.maxOutputTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(ticket) }],
        output_config: {
          effort: this.options.effort,
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        },
        ...(this.options.refusalFallback
          ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: 'default' as const }
          : {}),
      });
    } catch (error) {
      throw toProviderError(error);
    }

    return {
      text: message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join(''),
      outcome: outcomeOf(message.stop_reason),
      model: message.model,
      usage: usageOf(message, this.options.model),
    };
  }
}

function outcomeOf(stopReason: BetaMessage['stop_reason']): ProviderOutcome {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'completed';
    case 'refusal':
      return 'refused';
    default:
      // max_tokens, context window exceeded or any stop we did not ask for:
      // the JSON may be cut off, so the classifier treats it as invalid.
      return 'incomplete';
  }
}

/**
 * One entry per billed attempt. After a server-side fallback the response
 * carries usage.iterations (one per model that ran); top-level usage would
 * only cover the attempt that produced the final message.
 */
function usageOf(message: BetaMessage, requestedModel: string): TokenUsage[] {
  const iterations = message.usage.iterations ?? [];

  if (iterations.length === 0) {
    return [
      {
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
    ];
  }

  return iterations.map((iteration) => ({
    model:
      'model' in iteration && typeof iteration.model === 'string'
        ? iteration.model
        : requestedModel,
    inputTokens: iteration.input_tokens,
    outputTokens: iteration.output_tokens,
    cacheReadInputTokens: iteration.cache_read_input_tokens,
    cacheCreationInputTokens: iteration.cache_creation_input_tokens,
  }));
}

/** Most specific SDK error first; never leaks SDK messages to API clients. */
function toProviderError(error: unknown): LlmProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmProviderError('timeout', 'The LLM request timed out', { cause: error });
  }
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.InternalServerError ||
    error instanceof Anthropic.APIConnectionError
  ) {
    return new LlmProviderError('unavailable', 'The LLM provider is unavailable', { cause: error });
  }
  // 400/401/403/404...: a configuration or request bug on our side.
  return new LlmProviderError('upstream', 'The LLM provider rejected the request', {
    cause: error,
  });
}
