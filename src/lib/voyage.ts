// Voyage AI embedding client.
// Uses voyage-4-large at 1024 Matryoshka dimensions — see docs/architecture.md §3.2.
//
// Two flavours: embedDocuments (input_type: "document", used at ingest time)
// and embedQuery (input_type: "query", used by search_kb at chat time).
// Voyage explicitly trains the model to produce different embeddings for
// the same text under these two prompts; mixing them silently degrades recall.

import { recordUsage, type UsageAttribution } from "./usage";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_MODEL = "voyage-4-large";
export const VOYAGE_DIMS = 1024;

// Voyage allows up to 128 inputs per batch, AND caps the total tokens per
// submitted batch (120k for voyage-4-large). Both limits must be respected;
// dense documents can hit the token cap with far fewer than 128 inputs.
const MAX_BATCH = 128;
const MAX_BATCH_TOKENS = 100_000; // headroom under Voyage's 120k cap

// Conservative token estimate. Prose runs ~3 to 4 chars/token, but dense
// part-number tables (codes, digits, pipes, Danish letters) run closer to
// 1.3 chars/token: a Kvik parts list hit 221k real tokens in a batch this
// estimate had put under 100k at 3 chars/token. Characters that are not
// plain letters or spaces therefore count as a full token each.
// Overestimating just makes batches smaller; underestimating risks a 400,
// which embedBatch also survives by splitting the batch.
function estimateTokens(text: string): number {
  let dense = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const plain =
      (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 32;
    if (!plain) dense++;
  }
  const plainChars = text.length - dense;
  return Math.ceil(plainChars / 3 + dense) + 1;
}

// Voyage's 400 when a batch is over the per-request token cap. The text is
// "The max allowed tokens per submitted batch is 120000".
function isBatchTokenLimitError(status: number, body: string): boolean {
  return status === 400 && /tokens per submitted batch/i.test(body);
}

class BatchTooLargeError extends Error {}

type VoyageInputType = "document" | "query";

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
  usage?: { total_tokens?: number };
};

// Two retry/timeout policies. Ingest runs offline and can afford to wait
// out Voyage's free-tier rate limit; a chat query cannot — an operator is
// standing at the machine, and a search that takes two minutes is a
// search that never happened. The fast policy fails within ~10 s so the
// caller can fall back to keyword-only retrieval instead.
type EmbedPolicy = {
  maxAttempts: number;
  backoffMs: (attempt: number) => number;
  timeoutMs: number | null;
};

const INGEST_POLICY: EmbedPolicy = {
  // Free-tier Voyage accounts (no payment method) are capped at 3 RPM /
  // 10k TPM, so we accept up to 4 retries with exponential backoff on 429.
  maxAttempts: 5,
  // Linear-ish backoff that's tuned for the 3 RPM free-tier ceiling:
  // 25s, 30s, 35s, 40s. Total worst-case wait ~2.2 minutes per batch.
  backoffMs: (attempt) => 20_000 + attempt * 5_000,
  timeoutMs: null,
};

const FAST_POLICY: EmbedPolicy = {
  maxAttempts: 2,
  backoffMs: () => 1_500,
  timeoutMs: 8_000,
};

async function embedBatch(
  inputs: string[],
  inputType: VoyageInputType,
  usage?: UsageAttribution,
  policy: EmbedPolicy = INGEST_POLICY,
): Promise<number[][]> {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY not set");
  }
  if (inputs.length === 0) return [];
  if (inputs.length > MAX_BATCH) {
    throw new Error(
      `embedBatch: max ${MAX_BATCH} inputs per call, got ${inputs.length}`,
    );
  }

  // 429 and 5xx are retried per the policy; other 4xx are surfaced
  // immediately because retry won't fix them. A timeout (fast policy
  // only) counts as a retryable failure, same as a 5xx.
  const MAX_ATTEMPTS = policy.maxAttempts;
  let attempt = 0;
  while (true) {
    attempt++;
    let res: Response;
    try {
      res = await fetch(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({
          input: inputs,
          model: VOYAGE_MODEL,
          input_type: inputType,
          output_dimension: VOYAGE_DIMS,
          truncation: true,
        }),
        ...(policy.timeoutMs
          ? { signal: AbortSignal.timeout(policy.timeoutMs) }
          : {}),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      const delayMs = policy.backoffMs(attempt);
      console.warn(
        `  Voyage request failed (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${delayMs}ms:`,
        err instanceof Error ? err.message : err,
      );
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    if (res.ok) {
      const body = (await res.json()) as VoyageResponse;
      // Voyage reports one total, no in/out split — stored as input.
      if (usage && (body.usage?.total_tokens ?? 0) > 0) {
        await recordUsage({
          ...usage,
          provider: "voyage",
          model: VOYAGE_MODEL,
          operation: "embedding",
          inputTokens: body.usage!.total_tokens,
        });
      }
      const sorted = body.data.slice().sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    }

    const retryable = res.status === 429 || res.status >= 500;
    const text = await res.text();
    if (isBatchTokenLimitError(res.status, text) && inputs.length > 1) {
      throw new BatchTooLargeError(`Voyage ${res.status}: ${text}`);
    }
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`Voyage ${res.status}: ${text}`);
    }

    const delayMs = policy.backoffMs(attempt);
    console.warn(
      `  Voyage ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}); sleeping ${Math.round(delayMs / 1000)}s`,
    );
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

// embedBatch, but a batch Voyage rejects as over its token cap is halved
// and each half sent on its own, recursively. The estimate is only an
// estimate; this is what guarantees an unusual document still embeds.
// Order is preserved, so result[i] belongs to inputs[i].
async function embedBatchSplitting(
  inputs: string[],
  inputType: VoyageInputType,
  usage?: UsageAttribution,
  policy: EmbedPolicy = INGEST_POLICY,
): Promise<number[][]> {
  try {
    return await embedBatch(inputs, inputType, usage, policy);
  } catch (err) {
    if (!(err instanceof BatchTooLargeError)) throw err;
    const mid = Math.ceil(inputs.length / 2);
    console.warn(
      `  Voyage batch of ${inputs.length} over the token cap; splitting in two`,
    );
    const left = await embedBatchSplitting(
      inputs.slice(0, mid),
      inputType,
      usage,
      policy,
    );
    const right = await embedBatchSplitting(
      inputs.slice(mid),
      inputType,
      usage,
      policy,
    );
    return [...left, ...right];
  }
}

export type EmbedProgressHook = (
  done: number,
  total: number,
) => void | Promise<void>;

// Pre-split into batches that respect both the input-count and the
// per-batch token limits. A single oversized text still goes out alone;
// truncation: true clips it to the model context (32k), well under the cap.
// Exported so the resumable ingest pipeline can embed batch-by-batch and
// checkpoint between batches.
export function planEmbedBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const text of texts) {
    const tokens = estimateTokens(text);
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH || currentTokens + tokens > MAX_BATCH_TOKENS)
    ) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(text);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// Embed one pre-planned batch of document texts. The caller is
// responsible for keeping the batch within limits (use planEmbedBatches).
export async function embedDocumentBatch(
  texts: string[],
  usage?: UsageAttribution,
): Promise<number[][]> {
  return embedBatchSplitting(texts, "document", usage);
}

export async function embedDocuments(
  texts: string[],
  opts: { onBatchProgress?: EmbedProgressHook; usage?: UsageAttribution } = {},
): Promise<number[][]> {
  const batches = planEmbedBatches(texts);
  const out: number[][] = [];
  const totalBatches = batches.length;
  let batchesDone = 0;
  for (const slice of batches) {
    const batch = await embedBatchSplitting(slice, "document", opts.usage);
    out.push(...batch);
    batchesDone += 1;
    if (opts.onBatchProgress) {
      try {
        await opts.onBatchProgress(batchesDone, totalBatches);
      } catch (err) {
        // Progress reporting is best-effort; never let it abort embedding.
        console.warn("embedDocuments: onBatchProgress failed:", err);
      }
    }
  }
  return out;
}

// `fast` selects the chat-time policy (8 s timeout, one retry). Leave it
// off for offline callers that would rather wait than fail.
export async function embedQuery(
  text: string,
  usage?: UsageAttribution,
  opts: { fast?: boolean } = {},
): Promise<number[]> {
  // Eval kill-switch: lets scripts/eval.ts exercise the keyword-only
  // fallback in the chat route without taking Voyage down for real.
  // Never set in production.
  if (process.env.EVAL_FORCE_VOYAGE_FAIL === "1") {
    throw new Error("Voyage disabled by EVAL_FORCE_VOYAGE_FAIL");
  }
  const [vec] = await embedBatch(
    [text],
    "query",
    usage,
    opts.fast ? FAST_POLICY : INGEST_POLICY,
  );
  return vec;
}

// Batch variant of embedQuery — many short queries in as few Voyage calls
// as the batch limits allow. Used by the suggestion generator to ground-
// check a whole candidate pool at once.
export async function embedQueries(
  texts: string[],
  usage?: UsageAttribution,
): Promise<number[][]> {
  const out: number[][] = [];
  for (const slice of planEmbedBatches(texts)) {
    out.push(...(await embedBatchSplitting(slice, "query", usage)));
  }
  return out;
}
