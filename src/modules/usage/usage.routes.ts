import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { requireClient } from '../../http/auth.js';
import { problemResponses } from '../../http/openapi.js';
import { usageQuery, usageResponse } from './usage.schemas.js';
import type { UsageService } from './usage.service.js';

export const usageRoutes: FastifyPluginCallbackZod<{ service: UsageService }> = (
  app,
  { service },
  done,
) => {
  app.get(
    '/usage',
    {
      schema: {
        tags: ['usage'],
        summary: 'Token usage and estimated cost per day',
        description:
          'Every LLM attempt is counted, including invalid answers that had to be retried. ' +
          'Also returns the status of the daily token budget.',
        querystring: usageQuery,
        response: { 200: usageResponse, ...problemResponses(400, 401, 429) },
      },
    },
    async (request) => service.report(requireClient(request), request.query),
  );

  done();
};
