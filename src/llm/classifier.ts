import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../errors.js';
import { type Classification, parseClassification } from './classification.js';
import type { LlmProvider, ProviderResponse, TicketText } from './types.js';

export interface ClassificationResult {
  classification: Classification;
  response: ProviderResponse;
}

/**
 * Turns a provider's raw output into a validated Classification.
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
    const response = await this.provider.classify(ticket);
    const parsed = parseClassification(response.text);

    if (!parsed.success) {
      this.logger.warn({ reason: parsed.reason, issues: parsed.issues }, 'LLM output rejected');
      throw new AppError(502, 'llm_output_invalid', 'The classifier returned an invalid answer.');
    }

    return { classification: parsed.data, response };
  }
}
