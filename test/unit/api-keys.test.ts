import { describe, expect, it } from 'vitest';
import {
  API_KEY_PATTERN,
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
} from '../../src/modules/clients/api-keys.js';

describe('API keys', () => {
  it('generates prefixed, high-entropy keys', () => {
    const keys = new Set(Array.from({ length: 50 }, generateApiKey));

    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(API_KEY_PATTERN);
    }
  });

  it('hashes deterministically with SHA-256 and never returns the key', () => {
    const key = generateApiKey();

    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiKey(key)).not.toContain(key.slice(3));
  });

  it('exposes only a short, non-authenticating prefix', () => {
    const key = generateApiKey();

    expect(apiKeyPrefix(key)).toHaveLength(11);
    expect(key.startsWith(apiKeyPrefix(key))).toBe(true);
    expect(apiKeyPrefix(key)).not.toMatch(API_KEY_PATTERN);
  });
});
