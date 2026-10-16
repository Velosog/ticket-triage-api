/**
 * The only ticket data sent to an LLM. The customer's email address is
 * deliberately absent: classification does not need personal data.
 */
export interface TicketText {
  subject: string;
  body: string;
}

/** Tokens billed for one model attempt. */
export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/**
 * - completed: the model finished; `text` should contain the JSON answer
 * - truncated: the output hit max_tokens and is incomplete
 * - refused: the model (or its safety classifiers) declined the request
 */
export type ProviderOutcome = 'completed' | 'truncated' | 'refused';

export interface ProviderResponse {
  /** Raw model output. Untrusted until validated against the schema. */
  text: string;
  outcome: ProviderOutcome;
  /** Model that produced the final answer (may differ after a fallback). */
  model: string;
  /** Every billed attempt in this call (more than one after a fallback). */
  usage: TokenUsage[];
}

/**
 * Transport to a model. Validation and retry policy live in TicketClassifier,
 * so every provider (real or fake) gets the same guarantees.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  classify(ticket: TicketText): Promise<ProviderResponse>;
}

export type LlmProviderErrorKind = 'timeout' | 'unavailable' | 'upstream';

/** A provider failed before producing any answer. */
export class LlmProviderError extends Error {
  override readonly name = 'LlmProviderError';

  constructor(
    readonly kind: LlmProviderErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
