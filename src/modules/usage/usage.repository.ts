import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client.js';
import { llmUsage, type NewLlmUsageRow } from '../../db/schema.js';

export interface DailyUsageRow {
  date: string;
  requests: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export class UsageRepository {
  constructor(private readonly db: DbExecutor) {}

  async insertMany(rows: NewLlmUsageRow[]): Promise<void> {
    if (rows.length > 0) {
      await this.db.insert(llmUsage).values(rows);
    }
  }

  /** Input + output tokens billed to a client since `since`. */
  async tokensUsedSince(clientId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({
        tokens:
          sql<number>`coalesce(sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)`.mapWith(
            Number,
          ),
      })
      .from(llmUsage)
      .where(and(eq(llmUsage.clientId, clientId), gte(llmUsage.createdAt, since)));

    return row?.tokens ?? 0;
  }

  /** Usage grouped by UTC day, for days in [from, to). */
  async dailyUsage(clientId: string, from: Date, to: Date): Promise<DailyUsageRow[]> {
    const day = sql<string>`to_char(${llmUsage.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;

    return this.db
      .select({
        date: day,
        requests: sql<number>`count(distinct ${llmUsage.requestId})`.mapWith(Number),
        attempts: sql<number>`count(distinct (${llmUsage.requestId}, ${llmUsage.attempt}))`.mapWith(
          Number,
        ),
        inputTokens: sql<number>`sum(${llmUsage.inputTokens})`.mapWith(Number),
        outputTokens: sql<number>`sum(${llmUsage.outputTokens})`.mapWith(Number),
        costMicroUsd: sql<number>`sum(${llmUsage.costMicroUsd})`.mapWith(Number),
      })
      .from(llmUsage)
      .where(
        and(
          eq(llmUsage.clientId, clientId),
          gte(llmUsage.createdAt, from),
          lt(llmUsage.createdAt, to),
        ),
      )
      .groupBy(day)
      .orderBy(day);
  }
}
