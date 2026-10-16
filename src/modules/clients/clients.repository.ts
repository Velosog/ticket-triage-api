import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { clients, type ClientRow } from '../../db/schema.js';

export interface AuthenticatedClient {
  id: string;
  name: string;
  apiKeyPrefix: string;
  dailyTokenBudget: number;
}

export class ClientsRepository {
  constructor(private readonly db: Database) {}

  async findActiveByKeyHash(apiKeyHash: string): Promise<AuthenticatedClient | undefined> {
    const [row] = await this.db
      .select({
        id: clients.id,
        name: clients.name,
        apiKeyPrefix: clients.apiKeyPrefix,
        dailyTokenBudget: clients.dailyTokenBudget,
      })
      .from(clients)
      .where(and(eq(clients.apiKeyHash, apiKeyHash), eq(clients.isActive, true)))
      .limit(1);

    return row;
  }

  async insert(values: {
    name: string;
    apiKeyHash: string;
    apiKeyPrefix: string;
    dailyTokenBudget: number;
  }): Promise<ClientRow> {
    const [row] = await this.db.insert(clients).values(values).returning();
    if (row === undefined) {
      throw new Error('Insert returned no row');
    }
    return row;
  }
}
