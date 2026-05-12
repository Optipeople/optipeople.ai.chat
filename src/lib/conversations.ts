// Persistence helpers for chat conversations + messages. Every operator
// chat creates a `conversations` row and appends `messages` rows for the
// user turn, the assistant's text/tool-use, and each tool result.
//
// Server-only (uses the service-role Supabase client). Errors are
// logged and rethrown — the chat route swallows them at the boundary so
// audit failures don't break the live conversation.

import { getSupabaseServerClient } from "./supabase";

export type EntryMode = "qr" | "manual" | "deep_link" | "voice";

export async function createConversation(args: {
  machineId: string;
  accountId: string;
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
  entryMode?: EntryMode | null;
}): Promise<string> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      machine_id: args.machineId,
      account_id: args.accountId,
      user_id: args.userId,
      user_email: args.userEmail ?? null,
      user_name: args.userName ?? null,
      entry_mode: args.entryMode ?? "manual",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`createConversation failed: ${error?.message ?? "no row"}`);
  }
  return (data as { id: string }).id;
}

// Confirms the conversation exists and belongs to (machineId, userId).
// Prevents one operator from appending to another's conversation by
// guessing UUIDs. Returns null on mismatch — caller decides whether to
// fall back to creating a new row.
export async function validateConversation(
  conversationId: string,
  machineId: string,
  userId: string,
): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("machine_id", machineId)
    .eq("user_id", userId)
    .maybeSingle();
  return !error && !!data;
}

export async function appendUserMessage(
  conversationId: string,
  content: string,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content,
  });
  if (error) throw new Error(`appendUserMessage failed: ${error.message}`);
}

// One row per assistant turn from the agentic loop. content is the
// concatenated text the user sees; toolCalls capture any tool_use blocks
// emitted in the same turn so the audit drilldown can show which tools
// were invoked alongside the explanation. tokens_in/out come from the
// SDK's per-stream usage report, summed by the caller across iterations.
export async function appendAssistantTurn(args: {
  conversationId: string;
  content: string;
  toolCalls: { name: string; input: unknown }[];
  tokensIn?: number;
  tokensOut?: number;
  cacheHit?: boolean;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  // No text + no tool calls = nothing meaningful to record.
  if (!args.content && args.toolCalls.length === 0) return;

  const { error } = await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    role: "assistant",
    content: args.content,
    // For multi-tool turns we record the first one in the dedicated
    // columns (the canonical "what tool ran"), and stash any extras in
    // tool_input under a `_extra` key. Single-tool turns are the common
    // case.
    tool_name: args.toolCalls[0]?.name ?? null,
    tool_input:
      args.toolCalls.length === 0
        ? null
        : args.toolCalls.length === 1
          ? args.toolCalls[0].input
          : { ...(args.toolCalls[0].input ?? {}), _extra: args.toolCalls.slice(1) },
    tokens_in: args.tokensIn ?? null,
    tokens_out: args.tokensOut ?? null,
    cache_hit: args.cacheHit ?? null,
  });
  if (error) throw new Error(`appendAssistantTurn failed: ${error.message}`);
}

// One row per tool execution. content holds a JSON-stringified summary
// of the result (for human reading in the audit); tool_chunks captures
// the kb_chunks UUIDs returned by search_kb so the drilldown can show
// exactly which manual snippets were retrieved.
export async function appendToolMessage(args: {
  conversationId: string;
  toolName: string;
  toolInput: unknown;
  toolChunks: string[];
  contentSummary: string;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    role: "tool",
    content: args.contentSummary,
    tool_name: args.toolName,
    tool_input: args.toolInput as Record<string, unknown>,
    tool_chunks: args.toolChunks.length > 0 ? args.toolChunks : null,
  });
  if (error) throw new Error(`appendToolMessage failed: ${error.message}`);
}
