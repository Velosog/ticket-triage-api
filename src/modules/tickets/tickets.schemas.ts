import { z } from 'zod';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_SENTIMENTS } from '../../db/schema.js';
import { SUGGESTED_REPLY_MAX_LENGTH, SUMMARY_MAX_LENGTH } from '../../llm/classification.js';

export const createTicketBody = z.strictObject({
  subject: z.string().trim().min(1).max(200),
  // Bounded so a single ticket cannot blow up token usage and cost.
  body: z.string().trim().min(1).max(10_000),
  customerEmail: z.email().max(254),
});

export const ticketParams = z.object({ id: z.uuid() });

export const listTicketsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  category: z.enum(TICKET_CATEGORIES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});

export const ticketResponse = z.object({
  id: z.uuid(),
  subject: z.string(),
  customerEmail: z.string(),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  sentiment: z.enum(TICKET_SENTIMENTS),
  summary: z.string().max(SUMMARY_MAX_LENGTH),
  suggestedReply: z.string().max(SUGGESTED_REPLY_MAX_LENGTH),
  llm: z.object({
    provider: z.string(),
    model: z.string(),
    promptVersion: z.string(),
  }),
  usage: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
  }),
  createdAt: z.iso.datetime(),
});

export const ticketListResponse = z.object({
  data: z.array(ticketResponse),
  pagination: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type CreateTicketInput = z.infer<typeof createTicketBody>;
export type ListTicketsQuery = z.infer<typeof listTicketsQuery>;
export type TicketDto = z.infer<typeof ticketResponse>;
export type TicketListDto = z.infer<typeof ticketListResponse>;
