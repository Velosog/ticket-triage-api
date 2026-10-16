import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const TICKET_CATEGORIES = ['billing', 'technical', 'account', 'other'] as const;
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const TICKET_SENTIMENTS = ['negative', 'neutral', 'positive'] as const;

export const ticketCategory = pgEnum('ticket_category', TICKET_CATEGORIES);
export const ticketPriority = pgEnum('ticket_priority', TICKET_PRIORITIES);
export const ticketSentiment = pgEnum('ticket_sentiment', TICKET_SENTIMENTS);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

/**
 * API consumers. Only a SHA-256 hash of the API key is stored; the key itself
 * is shown once, when the client is created.
 */
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    apiKeyHash: text('api_key_hash').notNull().unique(),
    // First characters of the key ("tt_ab12cd34"), to identify it in support
    // conversations and logs without revealing it.
    apiKeyPrefix: text('api_key_prefix').notNull(),
    dailyTokenBudget: integer('daily_token_budget').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [check('clients_daily_token_budget_check', sql`${table.dailyTokenBudget} > 0`)],
);

/**
 * A classified ticket. Token and cost columns total every LLM attempt that
 * was needed to classify it (including a retried invalid output).
 */
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    customerEmail: text('customer_email').notNull(),
    category: ticketCategory('category').notNull(),
    priority: ticketPriority('priority').notNull(),
    sentiment: ticketSentiment('sentiment').notNull(),
    summary: text('summary').notNull(),
    suggestedReply: text('suggested_reply').notNull(),
    llmProvider: text('llm_provider').notNull(),
    llmModel: text('llm_model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    // Micro-dollars (1 USD = 1_000_000): integer math, no float rounding.
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Listing is always scoped to one client, newest first (keyset-friendly).
    index('tickets_client_created_idx').on(table.clientId, table.createdAt.desc(), table.id.desc()),
    index('tickets_client_category_created_idx').on(
      table.clientId,
      table.category,
      table.createdAt.desc(),
    ),
    index('tickets_client_priority_created_idx').on(
      table.clientId,
      table.priority,
      table.createdAt.desc(),
    ),
    check('tickets_summary_length_check', sql`char_length(${table.summary}) <= 280`),
  ],
);

export const LLM_OUTCOMES = ['success', 'invalid_output', 'refused', 'error'] as const;
export const llmOutcome = pgEnum('llm_outcome', LLM_OUTCOMES);

/**
 * One row per billed model attempt, including failed ones: an invalid answer
 * that had to be retried still cost tokens. Source of truth for usage
 * reports and daily budgets.
 */
export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // NULL when classification failed and no ticket was stored.
    ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    // Groups the attempts made for one API request.
    requestId: text('request_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    attempt: integer('attempt').notNull(),
    outcome: llmOutcome('outcome').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadInputTokens: integer('cache_read_input_tokens').notNull().default(0),
    cacheCreationInputTokens: integer('cache_creation_input_tokens').notNull().default(0),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Budget check (today) and usage report (date range) for one client.
    index('llm_usage_client_created_idx').on(table.clientId, table.createdAt),
    index('llm_usage_ticket_idx').on(table.ticketId),
  ],
);

export type ClientRow = typeof clients.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export type NewTicketRow = typeof tickets.$inferInsert;
export type NewLlmUsageRow = typeof llmUsage.$inferInsert;
