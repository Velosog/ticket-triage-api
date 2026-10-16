/** Server-side refusal fallback, routed by refusal category ("default"). */
export const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Models documented to accept `fallbacks: "default"` on the Claude API
 * (checked 2026-10-16). Haiku 5.5 has no server-side fallback: a declined
 * request stays declined, so enabling it there would silently do nothing.
 * Add a model here only when its docs list the parameter.
 */
const MODELS_WITH_REFUSAL_FALLBACK: ReadonlySet<string> = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

export function supportsRefusalFallback(model: string): boolean {
  return MODELS_WITH_REFUSAL_FALLBACK.has(model);
}
