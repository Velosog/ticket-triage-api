import { sql } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';

/** docker-compose exposes PostgreSQL on 5433; CI and other setups set TEST_DATABASE_URL. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://triage:change-me@localhost:5433/ticket_triage_test';

/**
 * Guard against pointing the destructive test setup at a real database:
 * only databases whose name ends in "_test" are accepted.
 */
export function assertTestDatabase(url: string | undefined): string {
  if (url === undefined) {
    throw new Error('DATABASE_URL is not set for tests');
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${name}" (name must end in _test)`);
  }
  return url;
}

export async function truncateAll(db: Database): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = result.rows.map((row) => `"public"."${row.tablename}"`);
  if (tables.length > 0) {
    await db.execute(sql.raw(`truncate table ${tables.join(', ')} restart identity cascade`));
  }
}
