import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { lines, logger: createLogger({ LOG_LEVEL: 'debug', NODE_ENV: 'test' }, stream) };
}

describe('logger redaction', () => {
  it('redacts authorization headers, API keys and customer emails', () => {
    const { lines, logger } = capture();

    logger.info(
      {
        req: { headers: { authorization: 'Bearer tt_secret_value', 'x-api-key': 'tt_other' } },
        apiKey: 'tt_top_level',
        customerEmail: 'jane@example.com',
        ticket: { customerEmail: 'nested@example.com' },
        body: { ticket: { customerEmail: 'deep@example.com' } },
        ANTHROPIC_API_KEY: 'sk-ant-should-not-appear',
      },
      'something happened',
    );

    const output = lines.join('');
    for (const secret of [
      'tt_secret_value',
      'tt_other',
      'tt_top_level',
      'jane@example.com',
      'nested@example.com',
      'deep@example.com',
      'sk-ant-should-not-appear',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('something happened');
  });

  it('writes structured JSON', () => {
    const { lines, logger } = capture();
    logger.warn({ clientId: 'c-1' }, 'hello');

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 40,
      service: 'ticket-triage-api',
      clientId: 'c-1',
      msg: 'hello',
    });
  });
});
