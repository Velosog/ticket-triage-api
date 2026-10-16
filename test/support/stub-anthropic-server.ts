import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

export type StubReply = { status: number; body: unknown } | { hang: true };

/**
 * A local HTTP server that stands in for api.anthropic.com, so the real SDK
 * (HTTP client, timeouts, retries, error classes) runs without any network
 * call to a paid API.
 */
export async function startStubAnthropic(reply: (request: RecordedRequest) => StubReply) {
  const requests: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>),
      };
      requests.push(recorded);

      const answer = reply(recorded);
      if ('hang' in answer) {
        return; // never respond: the client must time out
      }
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** A minimal successful Messages API response. */
export function messageBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      {
        type: 'text',
        text: JSON.stringify({
          category: 'billing',
          priority: 'medium',
          sentiment: 'neutral',
          summary: 'Customer was charged twice and asks for a refund.',
          suggestedReply: 'Thanks for letting us know. We are looking into the duplicate charge.',
        }),
      },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 812, output_tokens: 95, iterations: null },
    ...overrides,
  };
}
