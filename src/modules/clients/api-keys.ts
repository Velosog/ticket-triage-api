import { createHash, randomBytes } from 'node:crypto';

/**
 * API key format: "tt_" + 43 base64url characters (32 random bytes).
 * The prefix lets secret scanners and humans recognise a leaked key.
 */
export const API_KEY_PATTERN = /^tt_[A-Za-z0-9_-]{43}$/;

export function generateApiKey(): string {
  return `tt_${randomBytes(32).toString('base64url')}`;
}

/**
 * SHA-256 is the right tool here (unlike for passwords): the key carries 256
 * bits of randomness, so brute-forcing the hash is infeasible, and a fast,
 * deterministic hash allows a direct indexed lookup on every request.
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/** "tt_ab12cd34": enough to identify a key, useless for authenticating. */
export function apiKeyPrefix(apiKey: string): string {
  return apiKey.slice(0, 11);
}
