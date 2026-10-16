import { AppError } from '../../errors.js';
import type { AuthenticatedClient } from '../clients/clients.repository.js';
import { type BudgetService, startOfUtcDay } from './budget.service.js';
import type { UsageRepository } from './usage.repository.js';
import type { UsageDto, UsageQuery } from './usage.schemas.js';

const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 92;

export class UsageService {
  constructor(
    private readonly usage: UsageRepository,
    private readonly budget: BudgetService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async report(client: AuthenticatedClient, query: UsageQuery): Promise<UsageDto> {
    const to = query.to ?? toIsoDate(startOfUtcDay(this.now()));
    const from =
      query.from ?? toIsoDate(new Date(Date.parse(to) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS));
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const endExclusive = new Date(Date.parse(`${to}T00:00:00.000Z`) + DAY_MS);

    if ((endExclusive.getTime() - fromDate.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
      throw new AppError(
        400,
        'range_too_large',
        `The date range may span at most ${MAX_RANGE_DAYS} days.`,
      );
    }

    const rows = await this.usage.dailyUsage(client.id, fromDate, endExclusive);
    const days = rows.map(({ costMicroUsd, ...row }) => ({
      ...row,
      totalTokens: row.inputTokens + row.outputTokens,
      costUsd: costMicroUsd / 1_000_000,
    }));

    return {
      from,
      to,
      days,
      totals: {
        requests: sum(days, 'requests'),
        attempts: sum(days, 'attempts'),
        inputTokens: sum(days, 'inputTokens'),
        outputTokens: sum(days, 'outputTokens'),
        totalTokens: sum(days, 'totalTokens'),
        costUsd: sum(rows, 'costMicroUsd') / 1_000_000,
      },
      budget: await this.budget.status(client),
    };
  }
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sum<K extends string>(rows: Record<K, number>[], key: K): number {
  return rows.reduce((total, row) => total + row[key], 0);
}
