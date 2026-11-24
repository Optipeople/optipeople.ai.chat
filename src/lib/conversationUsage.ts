// AI usage per conversation: the level below the account usage panel.
//
// The usage_events rows a conversation causes carry its conversation_id:
// chat turns, voice, transcription and the post-conversation distill.
// Read-aloud (/api/voice/speak) does not yet — it never learns which
// conversation the answer came from — so it is missing here.
//
// This sums them per conversation, grouped by operation + model so each
// group can be priced through src/lib/pricing.ts exactly like the
// account view prices its rows.
//
// Server-only: uses the service-role Supabase client.

import { costUsd, totalCostUsd } from "./pricing";
import { getSupabaseServerClient } from "./supabase";
import {
  EMPTY_CONVERSATION_USAGE_TOTALS,
  type ConversationUsage,
  type ConversationUsageTotals,
} from "./conversationUsageTotals";
import type { AdminUsageRow } from "@/app/api/admin/accounts/[accountId]/usage/route";

export {
  EMPTY_CONVERSATION_USAGE_TOTALS,
  type ConversationUsage,
  type ConversationUsageTotals,
};

type SummaryRow = {
  conversation_id: string;
  operation: string;
  model: string;
  events: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

/**
 * Usage for each of the given conversations. Conversations with no
 * usage_events rows are absent from the map. Throws on a database error
 * so the caller decides whether that is fatal.
 */
export async function fetchConversationUsage(
  conversationIds: string[],
): Promise<Map<string, ConversationUsage>> {
  const result = new Map<string, ConversationUsage>();
  if (conversationIds.length === 0) return result;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("usage_conversation_summary", {
    p_conversation_ids: conversationIds,
  });
  if (error) throw new Error(error.message);

  const grouped = new Map<string, AdminUsageRow[]>();
  for (const r of (data ?? []) as SummaryRow[]) {
    const base = {
      operation: r.operation,
      model: r.model,
      events: Number(r.events),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
    };
    const list = grouped.get(r.conversation_id) ?? [];
    list.push({ ...base, costUsd: costUsd(base) });
    grouped.set(r.conversation_id, list);
  }

  for (const [id, rows] of grouped) {
    const cost = totalCostUsd(rows);
    const totals = rows.reduce<ConversationUsageTotals>(
      (acc, r) => ({
        ...acc,
        events: acc.events + r.events,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
        cacheWriteTokens: acc.cacheWriteTokens + r.cacheWriteTokens,
      }),
      {
        ...EMPTY_CONVERSATION_USAGE_TOTALS,
        costUsd: cost.usd,
        unpricedRows: cost.unpricedRows,
      },
    );
    result.set(id, { totals, rows });
  }
  return result;
}
