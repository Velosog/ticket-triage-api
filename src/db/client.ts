import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle; repositories accept either, so services own transactions. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | Transaction;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
}

export function createDatabase(url: string, maxConnections = 10): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: maxConnections,
    // Fail fast instead of queueing forever when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  return { db: drizzle(pool, { schema }), pool };
}
