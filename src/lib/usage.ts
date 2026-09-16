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
  | "auto_organize"
  // Voice. `voice` is a realtime assistant response; `transcription` is
  // the speech-to-text pass over the operator's microphone, which bills
  // separately and runs both inside a voice session and behind the
  // dictation button; `tts` is reading a chat answer aloud.
  | "voice"
  | "transcription"
  | "tts";

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

// OpenAI Realtime usage object, as it arrives on `response.done` and on
// `conversation.item.input_audio_transcription.completed`. Every field is
// optional: the transcription variant omits the output details, and a
// `whisper-1` session reports duration instead of tokens and so produces
// none of this at all.
export type RealtimeUsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  input_token_details?: {
    text_tokens?: number | null;
    audio_tokens?: number | null;
    cached_tokens?: number | null;
    cached_tokens_details?: {
      text_tokens?: number | null;
      audio_tokens?: number | null;
    } | null;
  } | null;
  output_token_details?: {
    text_tokens?: number | null;
    audio_tokens?: number | null;
  } | null;
};

/** One modality's slice of a realtime response, ready for recordUsage. */
export type UsageModalitySlice = {
  modality: "audio" | "text";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Splits a realtime usage object into its audio and text halves.
 *
 * Needed because audio and text bill at rates a factor of 8 apart and
 * usage_events has only one input column. The caller writes one row per
 * returned slice, under the `<model>:<modality>` key that
 * src/lib/pricing.ts prices.
 *
 * Two details worth knowing when reading this:
 *
 *   - OpenAI's `input_tokens` is the TOTAL, cached tokens included, and
 *     the per-modality detail counts are gross the same way. usage_events
 *     follows Anthropic's convention where input_tokens is the non-cached
 *     remainder, so cached tokens are subtracted out here.
 *   - When the response reports a cache total but no per-modality split,
 *     it all lands on the audio slice. That is exact rather than a
 *     compromise: cached input on gpt-realtime is $0.40/MTok whichever
 *     modality it was, so the attribution cannot change the bill.
 *
 * With no token details at all, everything collapses onto the audio
 * slice. That overstates text as audio, which is the direction this
 * codebase errs in deliberately (see the header of pricing.ts).
 */
export function splitRealtimeUsage(
  usage: RealtimeUsageLike,
): UsageModalitySlice[] {
  const inDetails = usage.input_token_details ?? null;
  const outDetails = usage.output_token_details ?? null;

  const cachedTotal = num(inDetails?.cached_tokens);
  const cachedSplit = inDetails?.cached_tokens_details ?? null;
  const cachedAudio = cachedSplit
    ? num(cachedSplit.audio_tokens)
    : cachedTotal;
  const cachedText = cachedSplit ? num(cachedSplit.text_tokens) : 0;

  const grossAudioIn = inDetails
    ? num(inDetails.audio_tokens)
    : num(usage.input_tokens);
  const grossTextIn = inDetails ? num(inDetails.text_tokens) : 0;

  const audio: UsageModalitySlice = {
    modality: "audio",
    inputTokens: Math.max(0, grossAudioIn - cachedAudio),
    outputTokens: outDetails
      ? num(outDetails.audio_tokens)
      : num(usage.output_tokens),
    cacheReadTokens: cachedAudio,
  };
  const text: UsageModalitySlice = {
    modality: "text",
    inputTokens: Math.max(0, grossTextIn - cachedText),
    outputTokens: outDetails ? num(outDetails.text_tokens) : 0,
    cacheReadTokens: cachedText,
  };

  // An all-zero slice would be a usage_events row saying nothing.
  return [audio, text].filter(
    (s) => s.inputTokens + s.outputTokens + s.cacheReadTokens > 0,
  );
}

const accountByMachine = new Map<string, string>();

export async function accountIdForMachine(
  machineId: string,
): Promise<string | null> {
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
