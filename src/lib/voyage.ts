// Voyage AI embedding client.
// Uses voyage-4-large at 1024 Matryoshka dimensions — see docs/architecture.md §3.2.
//
// Two flavours: embedDocuments (input_type: "document", used at ingest time)
// and embedQuery (input_type: "query", used by search_kb at chat time).
// Voyage explicitly trains the model to produce different embeddings for
// the same text under these two prompts; mixing them silently degrades recall.

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_MODEL = "voyage-4-large";
export const VOYAGE_DIMS = 1024;

// Voyage allows up to 128 inputs per batch.
const MAX_BATCH = 128;

type VoyageInputType = "document" | "query";

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
  usage?: { total_tokens?: number };
};

async function embedBatch(
  inputs: string[],
  inputType: VoyageInputType,
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

  // Free-tier Voyage accounts (no payment method) are capped at 3 RPM /
  // 10k TPM, so we accept up to 4 retries with exponential backoff on 429.
  // Other 5xx errors get the same treatment; 4xx (other than 429) are
  // surfaced immediately because retry won't fix them.
  const MAX_ATTEMPTS = 5;
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(VOYAGE_API_URL, {
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
    });

    if (res.ok) {
      const body = (await res.json()) as VoyageResponse;
      const sorted = body.data.slice().sort((a, b) => a.index - b.index);
      return sorted.map((d) => d.embedding);
    }

    const retryable = res.status === 429 || res.status >= 500;
    const text = await res.text();
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new Error(`Voyage ${res.status}: ${text}`);
    }

    // Linear-ish backoff that's tuned for the 3 RPM free-tier ceiling:
    // 25s, 30s, 35s, 40s. Total worst-case wait ~2.2 minutes per batch.
    const delayMs = 20_000 + attempt * 5_000;
    console.warn(
      `  Voyage ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}); sleeping ${Math.round(delayMs / 1000)}s`,
    );
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export type EmbedProgressHook = (
  done: number,
  total: number,
) => void | Promise<void>;

export async function embedDocuments(
  texts: string[],
  opts: { onBatchProgress?: EmbedProgressHook } = {},
): Promise<number[][]> {
  const out: number[][] = [];
  const totalBatches = Math.ceil(texts.length / MAX_BATCH);
  let batchesDone = 0;
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const slice = texts.slice(i, i + MAX_BATCH);
    const batch = await embedBatch(slice, "document");
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

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text], "query");
  return vec;
}
