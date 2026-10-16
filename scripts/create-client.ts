/**
 * Creates an API client and prints its API key once.
 *
 *   pnpm client:create --name "Acme Support" [--budget 200000]
 *
 * Only a SHA-256 hash of the key is stored: if the key is lost, create a new
 * client (or rotate) instead of trying to recover it.
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import { createClientWithApiKey } from '../src/modules/clients/clients.service.js';

const config = loadConfig();
const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    budget: { type: 'string' },
  },
});

const input = z
  .object({
    name: z.string({ error: '--name is required' }).trim().min(1, '--name is required').max(200),
    budget: z.coerce.number().int().positive().default(config.DEFAULT_DAILY_TOKEN_BUDGET),
  })
  .safeParse(values);

if (!input.success) {
  console.error(input.error.issues.map((issue) => issue.message).join('\n'));
  process.exit(1);
}

const { db, pool } = createDatabase(config.DATABASE_URL, 1);
try {
  const { client, apiKey } = await createClientWithApiKey(db, {
    name: input.data.name,
    dailyTokenBudget: input.data.budget,
  });

  console.log(`Client created: ${client.name} (${client.id})`);
  console.log(`Daily token budget: ${client.dailyTokenBudget}`);
  console.log('');
  console.log('API key (shown only once, store it in a secret manager):');
  console.log(apiKey);
} finally {
  await pool.end();
}
