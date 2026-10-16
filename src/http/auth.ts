import type { FastifyRequest } from 'fastify';
import { unauthorized } from '../errors.js';
import { API_KEY_PATTERN, hashApiKey } from '../modules/clients/api-keys.js';
import type {
  AuthenticatedClient,
  ClientsRepository,
} from '../modules/clients/clients.repository.js';
import type { AppInstance } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the authentication hook on every /v1 route. */
    client: AuthenticatedClient | null;
  }
}

/**
 * Adds API key authentication (Authorization: Bearer tt_...) to every route
 * in the plugin scope it is called from. Malformed keys are rejected before
 * any database lookup; valid-looking keys are hashed and looked up.
 */
export function registerApiKeyAuth(app: AppInstance, clients: ClientsRepository): void {
  app.decorateRequest('client', null);

  app.addHook('onRequest', async (request) => {
    const apiKey = bearerToken(request);
    if (apiKey === undefined || !API_KEY_PATTERN.test(apiKey)) {
      throw unauthorized();
    }

    const client = await clients.findActiveByKeyHash(hashApiKey(apiKey));
    if (client === undefined) {
      throw unauthorized();
    }

    request.client = client;
    // Child logger: every later log line of this request names the client.
    request.log = request.log.child({ clientId: client.id, apiKeyPrefix: client.apiKeyPrefix });
  });
}

export function requireClient(request: FastifyRequest): AuthenticatedClient {
  if (request.client === null) {
    throw unauthorized();
  }
  return request.client;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) {
    return undefined;
  }
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : undefined;
}
