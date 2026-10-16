import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/client.js';
import type { TicketRow } from '../../db/schema.js';
import { notFound } from '../../errors.js';
import { LlmFailure, type TicketClassifier } from '../../llm/classifier.js';
import { PROMPT_VERSION } from '../../llm/prompt.js';
import type { AuthenticatedClient } from '../clients/clients.repository.js';
import type { BudgetService } from '../usage/budget.service.js';
import { usageRows } from '../usage/usage-recorder.js';
import { UsageRepository } from '../usage/usage.repository.js';
import { TicketsRepository } from './tickets.repository.js';
import type {
  CreateTicketInput,
  ListTicketsQuery,
  TicketDto,
  TicketListDto,
} from './tickets.schemas.js';

export class TicketsService {
  constructor(
    private readonly db: Database,
    private readonly classifier: TicketClassifier,
    private readonly budget: BudgetService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  /**
   * Budget check -> LLM classification -> ticket + usage rows in one
   * transaction. If classification fails, the tokens spent are recorded
   * anyway (and count against the budget) before the error is returned.
   */
  async create(
    client: AuthenticatedClient,
    input: CreateTicketInput,
    requestId: string,
  ): Promise<TicketDto> {
    await this.budget.assertWithinBudget(client);

    const usageContext = {
      clientId: client.id,
      requestId,
      provider: this.classifier.providerName,
      defaultModel: this.classifier.model,
    };

    let result;
    try {
      // Only subject and body reach the LLM; the email address stays here.
      result = await this.classifier.classify({ subject: input.subject, body: input.body });
    } catch (error) {
      if (error instanceof LlmFailure) {
        await new UsageRepository(this.db).insertMany(
          usageRows({ ...usageContext, ticketId: null }, error.attempts, this.logger),
        );
      }
      throw error;
    }

    const { classification, model, attempts } = result;
    const row = await this.db.transaction(async (tx) => {
      const pending = usageRows({ ...usageContext, ticketId: null }, attempts, this.logger);
      const ticket = await new TicketsRepository(tx).insert({
        clientId: client.id,
        subject: input.subject,
        body: input.body,
        customerEmail: input.customerEmail,
        ...classification,
        llmProvider: this.classifier.providerName,
        llmModel: model,
        promptVersion: PROMPT_VERSION,
        // Every attempt is billed, including an invalid answer that was retried.
        inputTokens: sum(pending.map((usage) => usage.inputTokens)),
        outputTokens: sum(pending.map((usage) => usage.outputTokens)),
        costMicroUsd: sum(pending.map((usage) => usage.costMicroUsd)),
      });
      await new UsageRepository(tx).insertMany(
        pending.map((usage) => ({ ...usage, ticketId: ticket.id })),
      );
      return ticket;
    });

    return toDto(row);
  }

  async get(client: AuthenticatedClient, id: string): Promise<TicketDto> {
    const row = await new TicketsRepository(this.db).findForClient(client.id, id);
    if (row === undefined) {
      throw notFound('ticket');
    }
    return toDto(row);
  }

  async list(client: AuthenticatedClient, query: ListTicketsQuery): Promise<TicketListDto> {
    const { rows, total } = await new TicketsRepository(this.db).listForClient(client.id, query);

    return {
      data: rows.map(toDto),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function toDto(row: TicketRow): TicketDto {
  return {
    id: row.id,
    subject: row.subject,
    customerEmail: row.customerEmail,
    category: row.category,
    priority: row.priority,
    sentiment: row.sentiment,
    summary: row.summary,
    suggestedReply: row.suggestedReply,
    llm: { provider: row.llmProvider, model: row.llmModel, promptVersion: row.promptVersion },
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costMicroUsd / 1_000_000,
    },
    createdAt: row.createdAt.toISOString(),
  };
}
