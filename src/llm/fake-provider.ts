import type { Classification } from './classification.js';
import { SUMMARY_MAX_LENGTH } from './classification.js';
import type { LlmProvider, ProviderResponse, TicketText } from './types.js';

export const FAKE_MODEL = 'fake-triage-1';

/** A scripted step: a response, an error to throw, or a function of the ticket. */
export type FakeStep = ProviderResponse | Error | ((ticket: TicketText) => ProviderResponse);

const CATEGORY_RULES: [Classification['category'], RegExp][] = [
  ['billing', /\b(invoice|refund|charged?|billing|payment|subscription|price|pricing|plan)\b/i],
  ['account', /\b(password|log ?in|sign ?in|2fa|mfa|account|locked out|username)\b/i],
  [
    'technical',
    /\b(error|bug|crash(es|ed)?|broken|fail(s|ed|ing)?|timeout|api|outage|down|slow)\b/i,
  ],
];
const URGENT = /\b(outage|is down|urgent|asap|security|breach|data loss|production)\b/i;
const HIGH = /\b(cannot|can't|unable|blocked|broken|not working)\b/i;
const LOW = /\b(question|how do i|how can i|feature request|suggestion|wondering)\b/i;
const NEGATIVE =
  /\b(angry|terrible|awful|unacceptable|frustrat\w*|worst|disappointed|ridiculous)\b/i;
const POSITIVE = /\b(thanks|thank you|great|love|awesome|appreciate)\b/i;

const REPLIES: Record<Classification['category'], string> = {
  billing:
    'Thanks for reaching out about your billing question. Our billing team is reviewing your account and will get back to you shortly.',
  account:
    'Thanks for contacting us about your account. For your security, we will never ask for your password. Our team will help you regain access shortly.',
  technical:
    'Thanks for reporting this issue. Our technical team is investigating and will follow up with an update as soon as possible.',
  other: 'Thanks for your message. A member of our support team will get back to you shortly.',
};

/**
 * Deterministic, offline stand-in for a real LLM: same input, same output,
 * no network and no cost. Used by every test and for local development.
 *
 * Tests can script responses (including invalid output or errors) to
 * exercise the validation and retry policy; once the script is exhausted,
 * the keyword heuristics below answer.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = FAKE_MODEL;
  readonly calls: TicketText[] = [];

  constructor(private readonly script: FakeStep[] = []) {}

  classify(ticket: TicketText): Promise<ProviderResponse> {
    this.calls.push(ticket);
    const step = this.script.shift();

    if (step instanceof Error) {
      return Promise.reject(step);
    }
    if (typeof step === 'function') {
      return Promise.resolve(step(ticket));
    }
    return Promise.resolve(step ?? heuristicResponse(ticket));
  }
}

export function heuristicClassification(ticket: TicketText): Classification {
  const text = `${ticket.subject}\n${ticket.body}`;
  const category = CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
  const priority = URGENT.test(text)
    ? 'urgent'
    : HIGH.test(text)
      ? 'high'
      : LOW.test(text)
        ? 'low'
        : 'medium';
  const sentiment = NEGATIVE.test(text) ? 'negative' : POSITIVE.test(text) ? 'positive' : 'neutral';
  const summary = `Customer reports a ${category} issue: ${ticket.subject}`.slice(
    0,
    SUMMARY_MAX_LENGTH,
  );

  return { category, priority, sentiment, summary, suggestedReply: REPLIES[category] };
}

function heuristicResponse(ticket: TicketText): ProviderResponse {
  const text = JSON.stringify(heuristicClassification(ticket));

  return {
    text,
    outcome: 'completed',
    model: FAKE_MODEL,
    // Rough token estimate (~4 characters per token), so budgets can be tested.
    usage: [
      {
        model: FAKE_MODEL,
        inputTokens: Math.ceil((ticket.subject.length + ticket.body.length + 1200) / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    ],
  };
}
