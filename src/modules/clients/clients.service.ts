import type { Database } from '../../db/client.js';
import type { ClientRow } from '../../db/schema.js';
import { apiKeyPrefix, generateApiKey, hashApiKey } from './api-keys.js';
import { ClientsRepository } from './clients.repository.js';

export interface CreatedClient {
  client: ClientRow;
  /** Plain-text key. Returned once; only its hash is stored. */
  apiKey: string;
}

export async function createClientWithApiKey(
  db: Database,
  input: { name: string; dailyTokenBudget: number },
): Promise<CreatedClient> {
  const apiKey = generateApiKey();
  const client = await new ClientsRepository(db).insert({
    name: input.name,
    apiKeyHash: hashApiKey(apiKey),
    apiKeyPrefix: apiKeyPrefix(apiKey),
    dailyTokenBudget: input.dailyTokenBudget,
  });

  return { client, apiKey };
}
