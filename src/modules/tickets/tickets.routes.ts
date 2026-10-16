import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { requireClient } from '../../http/auth.js';
import { problemResponses } from '../../http/openapi.js';
import {
  createTicketBody,
  listTicketsQuery,
  ticketListResponse,
  ticketParams,
  ticketResponse,
} from './tickets.schemas.js';
import type { TicketsService } from './tickets.service.js';

/** Thin handlers: parse (via schemas), delegate to the service, respond. */
export const ticketsRoutes: FastifyPluginCallbackZod<{ service: TicketsService }> = (
  app,
  { service },
  done,
) => {
  app.post(
    '/tickets',
    {
      schema: {
        tags: ['tickets'],
        summary: 'Create and classify a ticket',
        description:
          'Classifies the ticket with the configured LLM and stores the result. ' +
          'Only the subject and body are sent to the LLM; the email address is not.',
        body: createTicketBody,
        response: { 201: ticketResponse, ...problemResponses(400, 401, 429, 502, 504) },
      },
    },
    async (request, reply) => {
      const ticket = await service.create(requireClient(request), request.body);
      return reply.code(201).send(ticket);
    },
  );

  app.get(
    '/tickets',
    {
      schema: {
        tags: ['tickets'],
        summary: 'List tickets (newest first)',
        querystring: listTicketsQuery,
        response: { 200: ticketListResponse, ...problemResponses(400, 401, 429) },
      },
    },
    async (request) => service.list(requireClient(request), request.query),
  );

  app.get(
    '/tickets/:id',
    {
      schema: {
        tags: ['tickets'],
        summary: 'Get one ticket',
        params: ticketParams,
        response: { 200: ticketResponse, ...problemResponses(400, 401, 404, 429) },
      },
    },
    async (request) => service.get(requireClient(request), request.params.id),
  );

  done();
};
