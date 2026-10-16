import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config.js';
import { AppError } from '../errors.js';
import { registerApiKeyAuth } from '../http/auth.js';
import type { ClientsRepository } from './clients/clients.repository.js';
import { ticketsRoutes } from './tickets/tickets.routes.js';
import type { TicketsService } from './tickets/tickets.service.js';

export interface V1Options {
  config: Config;
  clients: ClientsRepository;
  tickets: TicketsService;
}

/**
 * Everything under /v1: authenticated (onRequest) and then rate limited per
 * API key (preHandler, once the client is known).
 */
export const v1Routes: FastifyPluginAsyncZod<V1Options> = async (app, options) => {
  registerApiKeyAuth(app, options.clients);

  await app.register(rateLimit, {
    max: options.config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    hook: 'preHandler',
    // In-memory store: fine for one instance. Several instances need a shared
    // store (e.g. Redis) so the limit is not multiplied by the replica count.
    keyGenerator: (request) => request.client?.id ?? request.ip,
    errorResponseBuilder: (_request, context) =>
      new AppError(
        429,
        'rate_limited',
        `Rate limit exceeded: at most ${context.max} requests per ${context.after}.`,
        { limit: context.max },
        { 'retry-after': String(Math.ceil(context.ttl / 1000)) },
      ),
  });

  await app.register(ticketsRoutes, { service: options.tickets });
};
