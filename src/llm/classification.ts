import { z } from 'zod';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_SENTIMENTS } from '../db/schema.js';

export const SUMMARY_MAX_LENGTH = 280;
export const SUGGESTED_REPLY_MAX_LENGTH = 2000;

/**
 * The only shape an LLM answer may have. `strictObject` rejects unknown keys,
 * so a model coaxed into adding fields ("system_prompt", "admin": true...)
 * produces an invalid answer instead of leaking data into the API.
 */
export const classificationSchema = z.strictObject({
  category: z.enum(TICKET_CATEGORIES).describe('What the ticket is about'),
  priority: z.enum(TICKET_PRIORITIES).describe('How urgently support should act'),
  sentiment: z.enum(TICKET_SENTIMENTS).describe("The customer's tone"),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(SUMMARY_MAX_LENGTH)
    .describe(`One neutral sentence, at most ${SUMMARY_MAX_LENGTH} characters`),
  suggestedReply: z
    .string()
    .trim()
    .min(1)
    .max(SUGGESTED_REPLY_MAX_LENGTH)
    .describe('A short, polite first reply to the customer'),
});

export type Classification = z.infer<typeof classificationSchema>;

export type ParseResult =
  | { success: true; data: Classification }
  | { success: false; reason: 'not_json' | 'schema_mismatch'; issues: string[] };

/** Parses untrusted model output. Never throws. */
export function parseClassification(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { success: false, reason: 'not_json', issues: ['Output is not valid JSON'] };
  }

  const result = classificationSchema.safeParse(json);
  if (!result.success) {
    return {
      success: false,
      reason: 'schema_mismatch',
      // Paths and messages only: never echo the (untrusted) values themselves.
      issues: result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }

  return { success: true, data: result.data };
}
