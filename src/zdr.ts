// src/zdr.ts — OpenRouter Zero Data Retention (ZDR) guard for model selection.
//
// Sasha's OpenRouter account enforces zero data retention: OpenRouter rejects a
// request whose candidate endpoints are all non-ZDR with HTTP 404
// "zdr-violation-by-account". A session spawned (or retargeted) onto such a model
// therefore cannot run at all, and the run dies silently. Model selection must
// stay on ZDR-safe models.
//
// The lists below were verified against the live account on 2026-11-11 with
// `POST /api/v1/chat/completions` (a ZDR-safe model returns 200; a model with no
// ZDR endpoint returns 404 zdr-violation-by-account). They are a fast-path guard;
// `zdrDetail` translates the runtime error for any model not listed, so a fresh
// non-ZDR model still fails legibly.
import type { ModelRef } from "./types.js";

/** OpenRouter models verified to have at least one ZDR-compliant endpoint. */
export const ZDR_SAFE_MODELS: readonly string[] = [
  "deepseek/deepseek-v4.1-flash",
  "z-ai/glm-5.3",
  "openai/gpt-6-luna",
  "openai/gpt-5-mini",
  "reflection/beam-1.0-501b-a23b",
];

/** OpenRouter models known to have NO ZDR-compliant endpoint (all excluded by account ZDR). */
export const ZDR_UNSAFE_MODELS: readonly string[] = ["anthropic/claude-fable-5.2"];

/** True when an error text is OpenRouter's account-ZDR rejection. */
export function isZdrViolation(message?: string): boolean {
  if (!message) return false;
  return /zdr[- ]?violation|guardrail restrictions and data policy/i.test(message);
}

const FALLBACK_HINT = `choose a ZDR-safe model: ${ZDR_SAFE_MODELS.join(", ")}`;

/**
 * A legible message when `model` cannot run under the account ZDR policy, else
 * undefined. Only OpenRouter is gated; other providers pass through untouched.
 */
export function zdrModelError(model?: ModelRef | null): string | undefined {
  if (!model || model.providerID !== "openrouter") return undefined;
  if (!ZDR_UNSAFE_MODELS.includes(model.id)) return undefined;
  return (
    `model ${model.id} has no ZDR-compliant endpoint under Sasha's OpenRouter ` +
    `zero-data-retention policy, so OpenRouter rejects it (404 zdr-violation-by-account); ` +
    `${FALLBACK_HINT}.`
  );
}

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
