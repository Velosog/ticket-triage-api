import type { FastifyBaseLogger } from 'fastify';
import type { NewLlmUsageRow } from '../../db/schema.js';
import type { ClassificationAttempt } from '../../llm/classifier.js';
import { costMicroUsd, hasPricing } from '../../llm/pricing.js';

export interface UsageContext {
  clientId: string;
  ticketId: string | null;
  requestId: string;
  provider: string;
  /** Model to record for an attempt that failed before any usage was reported. */
  defaultModel: string;
}

/**
 * Converts classifier attempts into llm_usage rows (one per billed model
 * attempt). An attempt that failed before reaching the model gets a
 * zero-token row, so the report still shows the request.
 */
export function usageRows(
  context: UsageContext,
  attempts: ClassificationAttempt[],
  logger?: FastifyBaseLogger,
): NewLlmUsageRow[] {
  return attempts.flatMap((attempt) => {
    const usage =
      attempt.usage.length > 0
        ? attempt.usage
        : [
            {
              model: context.defaultModel,
              inputTokens: 0,
              outputTokens: 0,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
          ];

    return usage.map((entry) => {
      if (!hasPricing(entry.model)) {
        logger?.warn(
          { model: entry.model },
          'No price configured for model; charged at the highest rate',
        );
      }
      return {
        clientId: context.clientId,
        ticketId: context.ticketId,
        requestId: context.requestId,
        provider: context.provider,
        model: entry.model,
        attempt: attempt.attempt,
        outcome: attempt.outcome,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheReadInputTokens: entry.cacheReadInputTokens,
        cacheCreationInputTokens: entry.cacheCreationInputTokens,
        costMicroUsd: costMicroUsd(entry),
      };
    });
  });
}
