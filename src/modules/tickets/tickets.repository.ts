import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { type NewTicketRow, tickets, type TicketRow } from '../../db/schema.js';
import type { ListTicketsQuery } from './tickets.schemas.js';

export class TicketsRepository {
  constructor(private readonly db: Database) {}

  async insert(values: NewTicketRow): Promise<TicketRow> {
    const [row] = await this.db.insert(tickets).values(values).returning();
    if (row === undefined) {
      throw new Error('Insert returned no row');
    }
    return row;
  }

  /** Scoped by client: another client's ticket id is simply not found. */
  async findForClient(clientId: string, id: string): Promise<TicketRow | undefined> {
    const [row] = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.clientId, clientId), eq(tickets.id, id)))
      .limit(1);
    return row;
  }

  async listForClient(
    clientId: string,
    query: ListTicketsQuery,
  ): Promise<{ rows: TicketRow[]; total: number }> {
    const filters: SQL[] = [eq(tickets.clientId, clientId)];
    if (query.category !== undefined) filters.push(eq(tickets.category, query.category));
    if (query.priority !== undefined) filters.push(eq(tickets.priority, query.priority));
    const where = and(...filters);

    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(tickets)
        .where(where)
        .orderBy(desc(tickets.createdAt), desc(tickets.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: count() }).from(tickets).where(where),
    ]);

    return { rows, total: totals[0]?.total ?? 0 };
  }
}
