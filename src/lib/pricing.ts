// Turns usage_events token counts into money.
//
// usage_events has always recorded tokens but nothing converted them to a
// currency, so "the AI is expensive" stayed a feeling instead of a figure
// anyone could act on. This module is the missing layer: the admin usage
// views price every row through it.
//
// Deliberately a plain table of literals rather than anything clever.
// Provider prices change, and when they do you want one obvious file to
// edit with a date next to each number.
//
// PRICES LAST CHECKED: 2026-09-16
//   Anthropic  https://platform.claude.com/docs/en/pricing
//   Voyage     https://docs.voyageai.com/docs/pricing
//   OpenAI     https://developers.openai.com/api/docs/pricing
//
// Known approximations, all erring toward overstating rather than
// understating cost (a dashboard that flatters the bill is worse than one
// that doesn't):
//
//   - Cache writes are priced per TTL, but usage_events does not record
//     which TTL a write used. We infer it per operation (see
//     CACHE_WRITE_TTL_BY_OPERATION) rather than store it, because the only
//     caller writing at 1h is chat's system prompt.
//   - Claude Sonnet 5 is priced at its standard rate. Usage before
//     2026-09-01 was billed at the lower introductory rate ($2/$10), so
//     that window reads slightly high.
//   - Voyage's first 200M tokens per account are free. We price all
//     embedding tokens, so embeddings show a cost before they bill one.
//   - Text-to-speech returns no usage object, so its tokens are estimated
//     from the length of the text spoken rather than measured. Every
//     other line here is measured.

/** Dollars per million tokens. */
export type ModelPrice = {
  input: number;
  output: number;
  /**
   * Absolute cached-read price, when the model does not price its cache
   * as a multiple of its input rate. Anthropic does (a tenth of input),
   * so those entries leave this unset and take CACHE_READ_MULTIPLIER.
   * OpenAI Realtime does not: cached input is a flat $0.40/MTok whether
   * the cached tokens are text or audio, which is a fortieth of the
   * audio input rate, not a tenth. Applying the multiplier there would
   * overstate a long voice session by ~8x on its largest line, because
   * the whole conversation replays from cache on every turn.
   */
  cacheRead?: number;
  /** Same, for cache writes. Unset means the per-TTL multiplier applies. */
  cacheWrite?: number;
};

const MILLION = 1_000_000;

// Cache reads bill at a fraction of the input rate; cache writes at a
// premium over it. Multipliers, not absolute prices, because they apply
// uniformly across Anthropic models.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER_5M = 1.25;
const CACHE_WRITE_MULTIPLIER_1H = 2.0;

// Which cache TTL each operation writes at. Chat puts a 1h breakpoint on
// the per-machine system prompt (shared across conversations) and a
// default 5m one on the conversation tail; 1h is the larger and dominant
// share, so chat is priced at the 1h premium. Everything else does not use
// the prompt cache at all today and falls through to the 5m default.
const CACHE_WRITE_TTL_BY_OPERATION: Record<string, "5m" | "1h"> = {
  chat: "1h",
};

// Keyed by the exact `model` string written to usage_events, including
// dated aliases — src/lib/suggestions.ts and src/lib/autoOrganize.ts pin
// claude-haiku-4-5-20251001 while the chat route uses the bare alias, and
// both must price.
const MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-5": { input: 5, output: 25 },

  // Voyage — embeddings report a single total, stored as input_tokens.
  "voyage-4-large": { input: 0.12, output: 0 },
  "voyage-4": { input: 0.06, output: 0 },
  "voyage-4-lite": { input: 0.02, output: 0 },

  // OpenAI voice.
  //
  // These models bill text and audio tokens at very different rates — a
  // factor of 8 on input, 4 on output — and a voice session uses plenty
  // of both: the audio is the operator and the assistant talking, the
  // text is the machine's system prompt and document manifest replaying
  // on every turn. usage_events has one input column and one output
  // column, so a single row cannot hold the split.
  //
  // So the voice metering writes TWO rows per API response, one per
  // modality, keyed `<model>:audio` and `<model>:text`. See
  // splitRealtimeUsage in src/lib/usage.ts. The bare keys stay as the
  // audio rate: they are what an unsplit row (an older client, a usage
  // object with no token details) falls back to, and overstating is the
  // right direction to fail in.
  "gpt-realtime": { input: 32, output: 64, cacheRead: 0.4 },
  "gpt-realtime:audio": { input: 32, output: 64, cacheRead: 0.4 },
  "gpt-realtime:text": { input: 4, output: 16, cacheRead: 0.4 },

  // Input-audio transcription. Runs inside every realtime voice session
  // (the operator's mic is transcribed so we can render and persist it)
  // and standalone behind the dictation button. Output is always text.
  "gpt-4o-mini-transcribe": { input: 3, output: 5 },
  "gpt-4o-mini-transcribe:audio": { input: 3, output: 5 },
  "gpt-4o-mini-transcribe:text": { input: 1.25, output: 5 },

  // Per-message "read this answer aloud". The speech endpoint returns no
  // usage object at all, so src/app/api/voice/speak/route.ts estimates
  // both figures from the text length — see the constants there. Small
  // next to a realtime session, but not zero.
  "gpt-4o-mini-tts": { input: 0.6, output: 12 },
};

export type PriceableUsage = {
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** The price row for a model, or null when we have no price for it. */
export function modelPrice(model: string): ModelPrice | null {
  return MODEL_PRICES[model] ?? null;
}

/**
 * Cost in USD for one aggregated usage row, or null when the model has no
 * price entry. Null rather than 0 on purpose: an unpriced model must show
 * as unknown in the UI, not as free.
 */
export function costUsd(usage: PriceableUsage): number | null {
  const price = modelPrice(usage.model);
  if (!price) return null;

  const writeMultiplier =
    CACHE_WRITE_TTL_BY_OPERATION[usage.operation] === "1h"
      ? CACHE_WRITE_MULTIPLIER_1H
      : CACHE_WRITE_MULTIPLIER_5M;

  const cacheReadRate = price.cacheRead ?? price.input * CACHE_READ_MULTIPLIER;
  const cacheWriteRate = price.cacheWrite ?? price.input * writeMultiplier;

  const inputCost = usage.inputTokens * price.input;
  const outputCost = usage.outputTokens * price.output;
  const cacheReadCost = usage.cacheReadTokens * cacheReadRate;
  const cacheWriteCost = usage.cacheWriteTokens * cacheWriteRate;

  return (inputCost + outputCost + cacheReadCost + cacheWriteCost) / MILLION;
}

/**
 * Sums costs across rows. Rows with no known price contribute nothing to
 * the total but are counted in `unpricedRows`, so a view can say the total
 * is incomplete instead of quietly under-reporting it.
 */
export function totalCostUsd(rows: PriceableUsage[]): {
  usd: number;
  unpricedRows: number;
} {
  let usd = 0;
  let unpricedRows = 0;
  for (const row of rows) {
    const cost = costUsd(row);
    if (cost === null) unpricedRows++;
    else usd += cost;
  }
  return { usd, unpricedRows };
}

/**
 * Formats a USD amount for the admin UI. Sub-cent amounts still need to be
 * distinguishable from zero, so they get more precision rather than
 * rounding to $0.00.
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  // Anything that would render as $0.0000 gets a threshold instead: a
  // non-zero cost must never be displayed as zero.
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
