import type { Database } from '../../src/db/client.js';
import {
  createClientWithApiKey,
  type CreatedClient,
} from '../../src/modules/clients/clients.service.js';

export async function createTestClient(
  db: Database,
  overrides: { name?: string; dailyTokenBudget?: number } = {},
): Promise<CreatedClient & { headers: { authorization: string } }> {
  const created = await createClientWithApiKey(db, {
    name: overrides.name ?? 'Acme Support (test)',
    dailyTokenBudget: overrides.dailyTokenBudget ?? 1_000_000,
  });

  return { ...created, headers: { authorization: `Bearer ${created.apiKey}` } };
}

export const sampleTicket = {
  subject: 'Charged twice for my subscription',
  body: 'Hi, I was charged twice this month for the Pro plan. Can you refund one of the charges?',
  customerEmail: 'jane.doe@example.com',
};
