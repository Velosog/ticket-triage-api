import { STATUS_CODES } from 'node:http';
import { z } from 'zod';

/** RFC 9457 problem details, as returned by every error response. */
export const problemSchema = z
  .object({
    title: z.string(),
    status: z.number().int(),
    code: z.string().describe('Stable, machine-readable error code'),
    detail: z.string(),
    requestId: z.string(),
  })
  .loose()
  .describe('Problem details (application/problem+json)');

/** Response schemas for the error statuses a route can return. */
export function problemResponses(...statuses: number[]): Record<number, typeof problemSchema> {
  return Object.fromEntries(
    statuses.map((status) => [status, problemSchema.describe(STATUS_CODES[status] ?? 'Error')]),
  );
}
