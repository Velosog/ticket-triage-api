import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { createDatabase, type Database } from './client.js';

export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

/** Applies every pending SQL migration in ./drizzle, in order. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

// CLI entry point: `pnpm db:migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const logger = createLogger(config);
  const { db, pool } = createDatabase(config.DATABASE_URL, 1);

  try {
    await runMigrations(db);
    logger.info('Database migrations applied');
  } finally {
    await pool.end();
  }
}
