import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors.js';
import { type Classification, parseClassification } from './classification.js';
import {
  type LlmProvider,
  LlmProviderError,
  type ProviderResponse,
  type TicketText,
  type TokenUsage,
} from './types.js';

/** Validation failures are retried once; then the request fails. */
export const MAX_ATTEMPTS = 2;

export type AttemptOutcome = 'success' | 'invalid_output' | 'refused' | 'error';

/** One call to the provider, kept for usage and cost accounting. */
export interface ClassificationAttempt {
  attempt: number;
  outcome: AttemptOutcome;
  usage: TokenUsage[];
}

export interface ClassificationResult {
  classification: Classification;
  model: string;
  attempts: ClassificationAttempt[];
}

/**
 * A classification that could not be produced. Carries the attempts made so
 * the tokens they consumed are still recorded and counted against budgets.
 */
export class LlmFailure extends AppError {
  constructor(
    statusCode: number,
    code: string,
    detail: string,
    readonly attempts: ClassificationAttempt[],
    headers: Record<string, string> = {},
  ) {
    super(statusCode, code, detail, {}, headers);
  }
}

/**
 * Turns untrusted model output into a validated Classification:
 *
 * - the answer must be JSON matching the strict Zod schema;
 * - an invalid or incomplete answer is retried once, then fails with 502;
 * - a refusal is not retried (the same input would be declined again);
 * - provider errors map to 504 (timeout), 503 (unavailable) or 502.
 *
 * The policy lives here, not in the providers, so the real adapter and the
 * fake one get identical guarantees.
 */
export class TicketClassifier {
  constructor(
    private readonly provider: LlmProvider,
    private readonly logger: FastifyBaseLogger,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  async classify(ticket: TicketText): Promise<ClassificationResult> {
    const attempts: ClassificationAttempt[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: ProviderResponse;
      try {
        response = await this.provider.classify(ticket);
      } catch (error) {
        attempts.push({ attempt, outcome: 'error', usage: [] });
        throw this.providerFailure(error, attempts);
      }

      if (response.outcome === 'refused') {
        attempts.push({ attempt, outcome: 'refused', usage: response.usage });
        this.logger.warn({ attempt, model: response.model }, 'LLM declined to classify the ticket');
        throw new LlmFailure(
          502,
          'llm_refused',
          'The model declined to classify this ticket.',
          attempts,
        );
      }

      const parsed =
        response.outcome === 'incomplete'
          ? ({ success: false, reason: 'incomplete', issues: ['Output stopped early'] } as const)
          : parseClassification(response.text);

      if (parsed.success) {
        attempts.push({ attempt, outcome: 'success', usage: response.usage });
        return { classification: parsed.data, model: response.model, attempts };
      }

      attempts.push({ attempt, outcome: 'invalid_output', usage: response.usage });
      // Issue paths only: the raw output may echo customer text.
      this.logger.warn(
        { attempt, reason: parsed.reason, issues: parsed.issues.slice(0, 10) },
        'LLM output failed validation',
      );
    }

    this.logger.error({ attempts: attempts.length }, 'LLM output invalid after retry');
    throw new LlmFailure(
      502,
      'llm_output_invalid',
      'The classifier returned an invalid answer. Retry the request later.',
      attempts,
    );
  }

  private providerFailure(error: unknown, attempts: ClassificationAttempt[]): LlmFailure {
    if (error instanceof LlmProviderError) {
      switch (error.kind) {
        case 'timeout':
          this.logger.warn({ err: error }, 'LLM request timed out');
          return new LlmFailure(
            504,
            'llm_timeout',
            'The classifier did not answer in time.',
            attempts,
          );
        case 'unavailable':
          this.logger.warn({ err: error }, 'LLM provider unavailable');
          return new LlmFailure(
            503,
            'llm_unavailable',
            'The classifier is temporarily unavailable. Retry later.',
            attempts,
            { 'retry-after': '30' },
          );
        case 'upstream':
          break;
      }
    }

    this.logger.error({ err: error }, 'LLM provider error');
    return new LlmFailure(502, 'llm_upstream_error', 'The classifier failed.', attempts);
  }
}
