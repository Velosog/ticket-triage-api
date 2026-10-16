import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createLlmProvider } from './llm/provider-factory.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const { db, pool } = createDatabase(config.DATABASE_URL, config.DATABASE_POOL_MAX);

  const app = await buildApp({ config, db, logger, llmProvider: createLlmProvider(config) });
  app.addHook('onClose', async () => {
    await pool.end();
  });

  // Graceful shutdown: stop accepting requests, finish in-flight ones, close the pool.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error: unknown) => {
  // Config errors list variable names only, never their values.
  const message = error instanceof ConfigError ? error.message : 'Failed to start';
  process.stderr.write(`${message}\n`);
  if (!(error instanceof ConfigError)) {
    process.stderr.write(`${String(error)}\n`);
  }
  process.exit(1);
});
