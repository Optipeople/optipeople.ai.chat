// Shapes and helpers for per-conversation usage that the admin UI needs
// on the client. Kept apart from conversationUsage.ts, which reads the
// database and must never reach the browser bundle.

import type { AdminUsageRow } from "@/app/api/admin/accounts/[accountId]/usage/route";

export type ConversationUsageTotals = {
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** USD over the priced rows. Our cost basis — shown to super admins only. */
  costUsd: number;
  /** Groups left out of costUsd because their model has no price entry. */
  unpricedRows: number;
};

export type ConversationUsage = {
  totals: ConversationUsageTotals;
  rows: AdminUsageRow[];
};

export const EMPTY_CONVERSATION_USAGE_TOTALS: ConversationUsageTotals = {
  events: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  unpricedRows: 0,
};

/** Prompt tokens, cache traffic included — what "in" means in the UI. */
export function usageTokensIn(t: ConversationUsageTotals): number {
  return t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
}
