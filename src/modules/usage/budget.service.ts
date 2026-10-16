import { AppError } from '../../errors.js';
import type { AuthenticatedClient } from '../clients/clients.repository.js';
import type { UsageRepository } from './usage.repository.js';

const DAY_MS = 86_400_000;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface BudgetStatus {
  dailyTokenBudget: number;
  usedToday: number;
  remainingToday: number;
  resetsAt: string;
}

/**
 * Daily token budget per client (UTC day). Checked before calling the LLM.
 *
 * It is a soft cap: two concurrent requests near the limit can both pass, so
 * the overshoot is bounded by roughly one request's tokens. A hard cap would
 * need to reserve tokens up front (see README "What I would do next").
 */
export class BudgetService {
  constructor(
    private readonly usage: UsageRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async status(client: AuthenticatedClient): Promise<BudgetStatus> {
    const dayStart = startOfUtcDay(this.now());
    const usedToday = await this.usage.tokensUsedSince(client.id, dayStart);

    return {
      dailyTokenBudget: client.dailyTokenBudget,
      usedToday,
      remainingToday: Math.max(0, client.dailyTokenBudget - usedToday),
      resetsAt: new Date(dayStart.getTime() + DAY_MS).toISOString(),
    };
  }

  async assertWithinBudget(client: AuthenticatedClient): Promise<void> {
    const status = await this.status(client);

    if (status.remainingToday === 0) {
      const retryAfterSeconds = Math.ceil(
        (Date.parse(status.resetsAt) - this.now().getTime()) / 1000,
      );
      throw new AppError(
        429,
        'daily_token_budget_exceeded',
        'The daily token budget for this API key is exhausted. It resets at 00:00 UTC.',
        { budget: status },
        { 'retry-after': String(retryAfterSeconds) },
      );
    }
  }
}
