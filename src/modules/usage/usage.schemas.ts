import { z } from 'zod';

const isoDate = z.iso.date().describe('UTC date, YYYY-MM-DD');

export const usageQuery = z
  .object({
    from: isoDate.optional().describe('First day (inclusive). Defaults to 6 days before `to`.'),
    to: isoDate.optional().describe('Last day (inclusive). Defaults to today (UTC).'),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

const usageTotals = z.object({
  requests: z.number().int().describe('API requests that called the LLM'),
  attempts: z.number().int().describe('LLM attempts (a retried invalid answer counts twice)'),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  totalTokens: z.number().int(),
  costUsd: z.number().describe('Estimated cost from the pricing table'),
});

export const usageResponse = z.object({
  from: isoDate,
  to: isoDate,
  days: z.array(usageTotals.extend({ date: isoDate })).describe('Only days with usage are listed'),
  totals: usageTotals,
  budget: z.object({
    dailyTokenBudget: z.number().int(),
    usedToday: z.number().int(),
    remainingToday: z.number().int(),
    resetsAt: z.iso.datetime(),
  }),
});

export type UsageQuery = z.infer<typeof usageQuery>;
export type UsageDto = z.infer<typeof usageResponse>;
