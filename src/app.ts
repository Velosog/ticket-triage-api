import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { registerProblemHandlers } from './http/problem.js';
import type { AppInstance } from './http/types.js';
import { TicketClassifier } from './llm/classifier.js';
import type { LlmProvider } from './llm/types.js';
import { ClientsRepository } from './modules/clients/clients.repository.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { TicketsService } from './modules/tickets/tickets.service.js';
import { BudgetService } from './modules/usage/budget.service.js';
import { UsageRepository } from './modules/usage/usage.repository.js';
import { UsageService } from './modules/usage/usage.service.js';
import { v1Routes } from './modules/v1.js';

export const API_VERSION = '0.1.0';

export interface AppDependencies {
  config: Config;
  db: Database;
  logger: FastifyBaseLogger;
  llmProvider: LlmProvider;
  /** Clock used for daily budgets and usage reports (injectable for tests). */
  now?: () => Date;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Builds the Fastify application. Dependencies are injected so tests can run
 * the real HTTP stack against a test database and a fake LLM provider.
 */
export async function buildApp(deps: AppDependencies): Promise<AppInstance> {
  const now = deps.now ?? (() => new Date());
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

  // OpenAPI generated from the same Zod schemas that validate requests.
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Ticket Triage API',
        version: API_VERSION,
        description:
          'Classifies customer support tickets with an LLM. Errors use RFC 9457 problem ' +
          'details (application/problem+json) with a stable `code`.',
      },
      tags: [
        { name: 'tickets', description: 'Create, list and read classified tickets' },
        { name: 'usage', description: 'Token usage, cost and daily budget' },
        { name: 'health', description: 'Liveness and readiness probes' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'http',
            scheme: 'bearer',
            description: 'API key created with `pnpm client:create` (starts with `tt_`).',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  // staticCSP: a Content-Security-Policy compatible with the docs page.
  await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });

  // Composition root: routes -> services -> repositories / providers.
  const classifier = new TicketClassifier(deps.llmProvider, app.log);
  const budget = new BudgetService(new UsageRepository(deps.db), now);

  await app.register(healthRoutes, { db: deps.db });
  await app.register(v1Routes, {
    prefix: '/v1',
    config: deps.config,
    clients: new ClientsRepository(deps.db),
    tickets: new TicketsService(deps.db, classifier, budget, app.log),
    usage: new UsageService(new UsageRepository(deps.db), budget, now),
  });

  return app;
}
