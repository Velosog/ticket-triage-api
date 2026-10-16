import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { registerProblemHandlers } from './http/problem.js';
import type { AppInstance } from './http/types.js';
import { healthRoutes } from './modules/health/health.routes.js';

export interface AppDependencies {
  config: Config;
  db: Database;
  logger: FastifyBaseLogger;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Builds the Fastify application. Dependencies are injected so tests can run
 * the real HTTP stack against a test database and a fake LLM provider.
 */
export async function buildApp(deps: AppDependencies): Promise<AppInstance> {
  const app = Fastify({
    loggerInstance: deps.logger,
    trustProxy: deps.config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    // Reuse a well-formed incoming X-Request-Id, otherwise generate one.
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(helmet, { global: true });
  registerProblemHandlers(app);

  await app.register(healthRoutes, { db: deps.db });

  return app;
}
