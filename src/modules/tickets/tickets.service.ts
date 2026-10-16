import type { TicketRow } from '../../db/schema.js';
import { notFound } from '../../errors.js';
import type { TicketClassifier } from '../../llm/classifier.js';
import { PROMPT_VERSION } from '../../llm/prompt.js';
import type { AuthenticatedClient } from '../clients/clients.repository.js';
import type { TicketsRepository } from './tickets.repository.js';
import type {
  CreateTicketInput,
  ListTicketsQuery,
  TicketDto,
  TicketListDto,
} from './tickets.schemas.js';

export class TicketsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly classifier: TicketClassifier,
  ) {}

  async create(client: AuthenticatedClient, input: CreateTicketInput): Promise<TicketDto> {
    // Only subject and body reach the LLM; the email address stays here.
    const { classification, model, attempts } = await this.classifier.classify({
      subject: input.subject,
      body: input.body,
    });
    // Every attempt is billed, including an invalid answer that was retried.
    const usage = attempts.flatMap((attempt) => attempt.usage);

    const row = await this.tickets.insert({
      clientId: client.id,
      subject: input.subject,
      body: input.body,
      customerEmail: input.customerEmail,
      ...classification,
      llmProvider: this.classifier.providerName,
      llmModel: model,
      promptVersion: PROMPT_VERSION,
      inputTokens: sum(usage.map((entry) => entry.inputTokens)),
      outputTokens: sum(usage.map((entry) => entry.outputTokens)),
      costMicroUsd: 0,
    });

    return toDto(row);
  }

  async get(client: AuthenticatedClient, id: string): Promise<TicketDto> {
    const row = await this.tickets.findForClient(client.id, id);
    if (row === undefined) {
      throw notFound('ticket');
    }
    return toDto(row);
  }

  async list(client: AuthenticatedClient, query: ListTicketsQuery): Promise<TicketListDto> {
    const { rows, total } = await this.tickets.listForClient(client.id, query);

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
