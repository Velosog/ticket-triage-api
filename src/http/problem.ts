import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../errors.js';
import type { AppInstance } from './types.js';

export interface ProblemBody {
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
  [extension: string]: unknown;
}

/**
 * Sends an RFC 9457 "problem details" response. Every error the API returns
 * has this shape, with a stable `code` and the request's correlation id.
 */
export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): FastifyReply {
  const body: ProblemBody = {
    title: STATUS_CODES[status] ?? 'Error',
    status,
    code,
    detail,
    ...extra,
    requestId: request.id,
  };

  return reply.status(status).headers(headers).type('application/problem+json').send(body);
}

export function registerProblemHandlers(app: AppInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, 404, 'not_found', 'The requested resource was not found.'),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, 'Request failed');
      }
      return sendProblem(
        request,
        reply,
        error.statusCode,
        error.code,
        error.message,
        error.extra,
        error.headers,
      );
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendProblem(request, reply, 400, 'validation_failed', 'The request is invalid.', {
        errors: error.validation.map((issue) => ({
          location: error.validationContext,
          path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: issue.message,
        })),
      });
    }

    if (isResponseSerializationError(error)) {
      // Our own response did not match its schema: a bug, never the client's fault.
      request.log.error({ err: error }, 'Response failed schema validation');
      return sendProblem(request, reply, 500, 'internal_error', 'An unexpected error occurred.');
    }

    // Fastify's own client errors (malformed JSON, body too large, wrong content type...).
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return sendProblem(request, reply, status, 'bad_request', error.message);
    }

    request.log.error({ err: error }, 'Unhandled error');
    return sendProblem(
      request,
      reply,
      500,
      'internal_error',
      'An unexpected error occurred. Use the requestId when reporting it.',
    );
  });
}
