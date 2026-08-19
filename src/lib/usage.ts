// Per-account AI usage metering.
//
// recordUsage writes one usage_events row per upstream AI API call. It
// is strictly best-effort: any failure logs and returns, mirroring the
// chat route's audit-persistence stance — metering must never break the
// operator-facing flow (or an ingest pipeline) it is measuring.
//
// Attribution: most ingest-time helpers only know a machine id, so when
// accountId is absent we resolve it from machine_kb. The mapping is
// stable, so a process-lifetime cache keeps it to one lookup per machine
// per warm instance.
//
// Server-only: uses the service-role Supabase client.

import { getSupabaseServerClient } from "./supabase";

export type UsageProvider = "anthropic" | "voyage" | "openai";

export type UsageOperation =
  | "chat"
  | "embedding"
  | "pdf_ocr"
  | "image_caption"
  | "figure_extraction"
  | "table_extraction"
  | "doc_metadata"
  | "suggestions"
  | "auto_organize";

// Who/what to bill the call to. accountId wins; machineId alone is
// resolved via machine_kb.
export type UsageAttribution = {
  accountId?: string | null;
  machineId?: string | null;
  conversationId?: string | null;
  userId?: string | null;
};

export type UsageEvent = UsageAttribution & {
  provider: UsageProvider;
  model: string;
  operation: UsageOperation;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

// Shape-compatible with both GA and beta Anthropic usage objects — we
// only touch the four token fields, all of which may be absent/null.
type AnthropicUsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

// Spread helper: `...fromAnthropicUsage(final.usage)` at the call site.
export function fromAnthropicUsage(usage: AnthropicUsageLike): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

const accountByMachine = new Map<string, string>();

async function accountIdForMachine(machineId: string): Promise<string | null> {
  const cached = accountByMachine.get(machineId);
  if (cached) return cached;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("account_id")
    .eq("machine_id", machineId)
    .maybeSingle<{ account_id: string }>();
  if (error || !data?.account_id) return null;
  accountByMachine.set(machineId, data.account_id);
  return data.account_id;
}

export async function recordUsage(event: UsageEvent): Promise<void> {
  try {
    const accountId =
      event.accountId ??
      (event.machineId ? await accountIdForMachine(event.machineId) : null);
    if (!accountId) {
      console.warn(
        `usage: dropping ${event.operation} event — no account resolvable` +
          (event.machineId ? ` (machine=${event.machineId})` : ""),
      );
      return;
    }

    const supabase = getSupabaseServerClient();
    const { error } = await supabase.from("usage_events").insert({
      account_id: accountId,
      machine_id: event.machineId ?? null,
      conversation_id: event.conversationId ?? null,
      user_id: event.userId ?? null,
      provider: event.provider,
      model: event.model,
      operation: event.operation,
      input_tokens: event.inputTokens ?? 0,
      output_tokens: event.outputTokens ?? 0,
      cache_read_tokens: event.cacheReadTokens ?? 0,
      cache_write_tokens: event.cacheWriteTokens ?? 0,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(
      `usage: recordUsage(${event.operation}) failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}
