import { sql } from 'drizzle-orm';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Database } from '../../db/client.js';
import { AppError } from '../../errors.js';

const liveResponse = z.object({ status: z.literal('ok') });
const readyResponse = z.object({
  status: z.literal('ok'),
  checks: z.object({ database: z.literal('ok') }),
});

/**
 * Liveness: the process is up (no dependencies checked, so a database outage
 * does not get healthy containers restarted). Readiness: it can serve traffic.
 */
export const healthRoutes: FastifyPluginCallbackZod<{ db: Database }> = (app, { db }, done) => {
  app.get(
    '/health/live',
    {
      schema: { tags: ['health'], summary: 'Liveness probe', response: { 200: liveResponse } },
    },
    () => ({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness probe (checks the database)',
        response: { 200: readyResponse },
      },
    },
    async (request) => {
      try {
        await db.execute(sql`select 1`);
      } catch (error) {
        request.log.warn({ err: error }, 'Readiness check failed: database unreachable');
        throw new AppError(503, 'not_ready', 'The database is not reachable.');
      }
      return { status: 'ok' as const, checks: { database: 'ok' as const } };
    },
  );

  done();
};
