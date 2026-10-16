import { sql } from 'drizzle-orm';
import { createDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { assertTestDatabase, TEST_DATABASE_URL } from './support/database.js';

/**
 * Runs once before the whole suite: rebuilds the test database schema from
 * the versioned migrations, which also proves the migrations apply cleanly.
 */
export default async function setup(): Promise<void> {
  const url = assertTestDatabase(TEST_DATABASE_URL);
  const { db, pool } = createDatabase(url, 1);

  try {
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
    await runMigrations(db);
  } finally {
    await pool.end();
  }
}
