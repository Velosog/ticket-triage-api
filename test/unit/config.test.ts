import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const base = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/app',
  LLM_PROVIDER: 'fake',
};

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    const config = loadConfig(base);

    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LLM_MODEL: 'claude-opus-5-5',
      LLM_EFFORT: 'low',
      LLM_TIMEOUT_MS: 20_000,
      RATE_LIMIT_PER_MINUTE: 60,
      TRUST_PROXY: false,
      LLM_REFUSAL_FALLBACK: true,
    });
  });

  it('coerces numbers and booleans from strings', () => {
    const config = loadConfig({ ...base, PORT: '8080', TRUST_PROXY: 'true' });

    expect(config.PORT).toBe(8080);
    expect(config.TRUST_PROXY).toBe(true);
  });

  it('fails fast when required variables are missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*LLM_PROVIDER/);
  });

  it('treats empty values (KEY= in .env) as not set', () => {
    const config = loadConfig({ ...base, ANTHROPIC_API_KEY: '', PORT: '' });

    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
    expect(config.PORT).toBe(3000);
  });

  it('requires an API key for the real provider', () => {
    expect(() => loadConfig({ ...base, LLM_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('refuses a model without a configured price (cost tracking would be wrong)', () => {
    expect(() =>
      loadConfig({
        ...base,
        LLM_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'k',
        LLM_MODEL: 'claude-unknown-9',
      }),
    ).toThrow(/LLM_MODEL/);
  });

  it('rejects the fake provider in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/LLM_PROVIDER/);
  });

  it('rejects a non-postgres database URL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('never includes variable values in the error message', () => {
    const secret = 'sk-ant-this-must-not-leak';
    let message = '';
    try {
      loadConfig({ ...base, ANTHROPIC_API_KEY: secret, LLM_PROVIDER: 'nope' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('LLM_PROVIDER');
    expect(message).not.toContain(secret);
  });
});
