/**
 * GET /api/v1/ai: which models write for the desk (src/ai/claude.ts).
 * POST /api/v1/ai { provider?, model?, budgetUsd? } changes it, the owner only.
 *
 * Types only: the server imports this file with `import type`.
 */

export type AiProvider = "local" | "anthropic";
export type AiModel = "claude-opus-5-5" | "claude-sonnet-5-5";

export interface AiState {
  /** What the switch is set to. */
  provider: AiProvider;
  /** What writes right now: local when the switch is, or when Anthropic cannot (no key, budget spent). */
  effective: AiProvider;
  /** Why `effective` differs from `provider`, in a few words. Null when it does not. */
  why: string | null;
  model: AiModel;
  models: { id: AiModel; label: string; note: string }[];
  /** The month's cap in dollars. At it, the desk writes locally until the 1st. */
  budgetUsd: number;
  /** Spent on Anthropic since the 1st of this month (UTC). */
  spentUsd: number;
  calls: number;
  /** Where the server found its Anthropic key, in words; null when it has none. Never the key. */
  key: string | null;
  /** The last calls, newest first. `at` is SQL UTC. */
  recent: { at: string; model: string; purpose: string; usd: number }[];
}
