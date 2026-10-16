import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import type { Config } from './config.js';

/**
 * Paths removed from every log line. Credentials and personal data must never
 * reach log storage, even at debug level or inside error objects.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers.cookie',
  'headers.authorization',
  'authorization',
  'apiKey',
  '*.apiKey',
  'customerEmail',
  '*.customerEmail',
  '*.*.customerEmail',
  'ANTHROPIC_API_KEY',
  '*.ANTHROPIC_API_KEY',
];

export function loggerOptions(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    base: { service: 'ticket-triage-api' },
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    // Readable logs on a developer machine; JSON everywhere else.
    ...(config.NODE_ENV === 'development' && process.stdout.isTTY
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  };
}

export function createLogger(
  config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>,
  destination?: DestinationStream,
): Logger {
  return destination ? pino(loggerOptions(config), destination) : pino(loggerOptions(config));
}
