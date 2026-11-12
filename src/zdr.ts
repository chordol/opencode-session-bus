// src/zdr.ts — OpenRouter Zero Data Retention (ZDR) guard for model selection.
//
// Sasha's OpenRouter account enforces zero data retention by default: OpenRouter
// rejects a request whose candidate endpoints are all non-ZDR with HTTP 404
// "zdr-violation-by-account". The account-level ZDR exception for the Anthropic
// model group was turned OFF on 2026-11-11, so Anthropic models (e.g.
// anthropic/claude-fable-5.2) now route normally and are no longer refused here.
//
// There is no static block list: whether a model can run is decided by the account
// settings, and `zdrDetail` translates the runtime rejection legibly for any model
// the account still refuses for ZDR. `ZDR_SAFE_MODELS` is the verified-safe short
// list surfaced in the tool descriptions.

/** OpenRouter models verified to have at least one ZDR-compliant endpoint. */
export const ZDR_SAFE_MODELS: readonly string[] = [
  "deepseek/deepseek-v4.1-flash",
  "z-ai/glm-5.3",
  "openai/gpt-6-luna",
  "openai/gpt-5-mini",
  "reflection/beam-1.0-501b-a23b",
  "anthropic/claude-fable-5.2",
];

/** True when an error text is OpenRouter's account-ZDR rejection. */
export function isZdrViolation(message?: string): boolean {
  if (!message) return false;
  return /zdr[- ]?violation|guardrail restrictions and data policy/i.test(message);
}

const FALLBACK_HINT = `choose a ZDR-safe model: ${ZDR_SAFE_MODELS.join(", ")}`;

/**
 * Make a provider failure legible. A ZDR rejection is rewritten to say so and to
 * name the ZDR-safe fallbacks; any other error is returned unchanged.
 */
export function zdrDetail(message: string): string {
  if (!isZdrViolation(message)) return message;
  return (
    `OpenRouter rejected the run under Sasha's zero-data-retention policy ` +
    `(zdr-violation-by-account): the chosen model has no ZDR-compliant endpoint; ` +
    `${FALLBACK_HINT}. Original error: ${message}`
  );
}
