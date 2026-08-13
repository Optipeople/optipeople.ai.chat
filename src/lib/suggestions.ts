// Per-machine bilingual starter-question generator.
//
// Runs after KB content changes (ingest, reprocess, reset, document
// delete) and stashes English + Danish question pools on machine_kb. The
// chat empty state reads the bucket matching the operator's locale on
// session start; an empty array means the UI falls back to broad generic
// prompts.
//
// Cheap by design — we feed only document summaries (already on the
// kb_documents row) plus the machine display name, so the prompt stays
// well under a couple of thousand tokens even with dozens of manuals. A
// single Haiku call returns both languages.
//
// Generation is grounding-checked before persisting: summaries are often
// just file names (`summary: args.summary ?? title` at ingest), so the
// model can produce plausible questions the manuals never answer. We
// over-generate CANDIDATE_COUNT pairs, embed each question, and keep only
// pairs whose best KB chunk clears MIN_TOP_SIMILARITY — the same
// embedding space the chat's search_kb retrieval runs in.

import Anthropic from "@anthropic-ai/sdk";
import { defaultLocale, isLocale, locales, type Locale } from "@/i18n/config";
import { getSupabaseServerClient } from "./supabase";
import { fromAnthropicUsage, recordUsage } from "./usage";
import { embedQueries, VOYAGE_MODEL } from "./voyage";

const MODEL = "claude-haiku-4-5-20251001";
// Pool size per language. The chat client picks 3 at random on load, so a
// larger pool means more variety across sessions.
const TARGET_COUNT = 10;
// How many candidate pairs to ask the model for. The surplus over
// TARGET_COUNT is headroom for the grounding filter to discard.
const CANDIDATE_COUNT = 16;
// A candidate pair survives if either language's question reaches this
// cosine similarity against its best kb_chunk. Deliberately conservative:
// the ranking (best TARGET_COUNT kept) does the fine sorting; this floor
// only cuts questions with no real manual content behind them. Dropped
// candidates are logged with their scores for later calibration.
const MIN_TOP_SIMILARITY = 0.45;
const MAX_DOC_SUMMARIES = 30;

const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  da: "Danish",
};

export type SuggestionsBundle = Record<Locale, string[]>;

const EMPTY_BUNDLE: SuggestionsBundle = Object.fromEntries(
  locales.map((l) => [l, [] as string[]]),
) as SuggestionsBundle;

const SYSTEM_PROMPT = `You generate short starter questions for a chat assistant used by operators of wood-industry machines.

The operator is at the machine and wants fast, concrete answers from the manual. Each question must be:
- Short — at most 8 words.
- Concrete and different — avoid overlap. Aim for breadth across alarms / error codes, daily operation, maintenance schedules, settings & calibration, troubleshooting, and safety. Don't repeat the same topic twice.
- Grounded in the machine's actual manual content. Use ONLY alarm codes, button names, or components that explicitly appear in the manual extracts below — never invent codes or names.
- Technical terms, alarm codes, and button names stay in the original language as they appear in the manual (do not translate them).

Produce EXACTLY ${CANDIDATE_COUNT} questions in BOTH English and Danish. The same ${CANDIDATE_COUNT} topics in each language — i.e. en[i] and da[i] cover the same question, just translated.

Return EXACTLY this JSON object — no prose, no markdown fences:
{"en": ["...", "...", ...], "da": ["...", "...", ...]}`;

type DocSummaryRow = {
  title: string | null;
  summary: string | null;
};

type MachineKbHead = {
  display_name: string | null;
};

export async function regenerateSuggestedQuestions(
  machineId: string,
): Promise<SuggestionsBundle> {
  const supabase = getSupabaseServerClient();

  const { data: docs, error: docsErr } = await supabase
    .from("kb_documents")
    .select("title, summary")
    .eq("machine_id", machineId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(MAX_DOC_SUMMARIES);
  if (docsErr) {
    throw new Error(`suggestions: kb_documents read failed: ${docsErr.message}`);
  }

  const ready = (docs ?? []) as DocSummaryRow[];

  // Empty KB → store empty bundle. UI falls back to broad generic prompts
  // client-side. No LLM call needed.
  if (ready.length === 0) {
    await persistSuggestions(machineId, EMPTY_BUNDLE);
    return EMPTY_BUNDLE;
  }

  const { data: machine } = await supabase
    .from("machine_kb")
    .select("display_name")
    .eq("machine_id", machineId)
    .maybeSingle<MachineKbHead>();
  const machineName = machine?.display_name?.trim() || null;

  const corpus = ready
    .map((d, i) => {
      const title = d.title?.trim() || `Document ${i + 1}`;
      const summary = d.summary?.trim() || "(no description)";
      return `[${i + 1}] ${title}\n${summary}`;
    })
    .join("\n\n");

  const userPrompt = [
    machineName
      ? `Machine name: ${machineName}`
      : "Machine name is not provided.",
    "",
    `Manual languages required: ${locales.map((l) => LOCALE_LABELS[l]).join(", ")}.`,
    "",
    `Machine manuals (${ready.length} documents):`,
    "",
    corpus,
    "",
    `Generate ${CANDIDATE_COUNT} short starter questions per language as the JSON object described.`,
  ].join("\n");

  const anthropic = new Anthropic();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  await recordUsage({
    machineId,
    provider: "anthropic",
    model: MODEL,
    operation: "suggestions",
    ...fromAnthropicUsage(res.usage),
  });

  const text = res.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  const candidates = parseBundleJson(text);

  // Grounding check — drop candidates the KB can't actually answer.
  // Best-effort: if Voyage or the RPC is unavailable we'd rather persist
  // unvalidated questions than leave the machine with a stale pool.
  let bundle: SuggestionsBundle;
  try {
    bundle = await filterUngroundedQuestions(machineId, candidates);
  } catch (err) {
    console.warn(
      `suggestions: grounding check failed for machine=${machineId}, persisting unvalidated pool:`,
      err instanceof Error ? err.message : err,
    );
    bundle = truncateBundle(candidates);
  }

  await persistSuggestions(machineId, bundle);
  return bundle;
}

// One candidate topic = the same question in every locale (en[i]/da[i]).
// Scored by the best cosine similarity any of its language variants
// achieves against the machine's chunks, so a Danish question about an
// English manual isn't punished for the language gap.
type CandidateTopic = {
  variants: { locale: Locale; text: string }[];
  score: number;
};

async function filterUngroundedQuestions(
  machineId: string,
  candidates: SuggestionsBundle,
): Promise<SuggestionsBundle> {
  const maxLen = Math.max(...locales.map((l) => candidates[l].length));
  const topics: CandidateTopic[] = [];
  for (let i = 0; i < maxLen; i++) {
    const variants = locales
      .filter((l) => candidates[l][i])
      .map((l) => ({ locale: l, text: candidates[l][i] }));
    if (variants.length > 0) topics.push({ variants, score: 0 });
  }
  if (topics.length === 0) return EMPTY_BUNDLE;

  // One Voyage batch for every variant of every topic, then one cheap
  // top-1 similarity RPC per variant.
  const texts = topics.flatMap((t) => t.variants.map((v) => v.text));
  const embeddings = await embedQueries(texts, { machineId });
  const sims = await Promise.all(
    embeddings.map((vec) => maxChunkSimilarity(machineId, vec)),
  );
  let cursor = 0;
  for (const topic of topics) {
    for (let v = 0; v < topic.variants.length; v++) {
      topic.score = Math.max(topic.score, sims[cursor++]);
    }
  }

  const kept = topics
    .filter((t) => t.score >= MIN_TOP_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGET_COUNT);
  const dropped = topics.filter((t) => t.score < MIN_TOP_SIMILARITY);
  if (dropped.length > 0) {
    console.info(
      `suggestions: machine=${machineId} dropped ${dropped.length}/${topics.length} ungrounded candidate(s): ` +
        dropped
          .map((t) => `"${t.variants[0].text}" (${t.score.toFixed(2)})`)
          .join(", "),
    );
  }

  const out = Object.fromEntries(
    locales.map((l) => [l, [] as string[]]),
  ) as SuggestionsBundle;
  for (const topic of kept) {
    for (const v of topic.variants) out[v.locale].push(v.text);
  }
  return out;
}

async function maxChunkSimilarity(
  machineId: string,
  queryEmbedding: number[],
): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("kb_max_similarity", {
    p_machine_id: machineId,
    p_query_embedding: queryEmbedding,
    p_embedding_model: VOYAGE_MODEL,
  });
  if (error) {
    throw new Error(`kb_max_similarity rpc: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

function truncateBundle(bundle: SuggestionsBundle): SuggestionsBundle {
  return Object.fromEntries(
    locales.map((l) => [l, bundle[l].slice(0, TARGET_COUNT)]),
  ) as SuggestionsBundle;
}

// Best-effort wrapper for triggers that shouldn't fail the parent flow
// (ingestion success, doc delete, etc.). Logs and swallows.
export async function regenerateSuggestedQuestionsSafe(
  machineId: string,
): Promise<void> {
  try {
    await regenerateSuggestedQuestions(machineId);
  } catch (err) {
    console.warn(
      `suggestions: regenerate failed for machine=${machineId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

export async function getSuggestedQuestions(
  machineId: string,
  locale: Locale,
): Promise<string[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("suggested_questions")
    .eq("machine_id", machineId)
    .maybeSingle<{ suggested_questions: unknown }>();
  if (error) {
    console.warn(
      `suggestions: read failed for machine=${machineId}:`,
      error.message,
    );
    return [];
  }
  const bundle = coerceBundle(data?.suggested_questions);
  // Empty locale bucket → try the default locale as a soft fallback, so
  // a half-regenerated row still shows something useful instead of the
  // generic fallback questions.
  if (bundle[locale].length > 0) return bundle[locale];
  return bundle[defaultLocale] ?? [];
}

async function persistSuggestions(
  machineId: string,
  bundle: SuggestionsBundle,
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("machine_kb")
    .update({
      suggested_questions: bundle,
      suggestions_updated_at: new Date().toISOString(),
    })
    .eq("machine_id", machineId);
  if (error) {
    throw new Error(`suggestions: persist failed: ${error.message}`);
  }
}

// The model is instructed to return a bare JSON object, but Haiku
// occasionally wraps it in a ```json fence or prefixes a sentence. Strip
// fences and locate the first `{...}` block before parsing.
function parseBundleJson(text: string): SuggestionsBundle {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return EMPTY_BUNDLE;
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    // Keep the full candidate pool here — the grounding filter cuts it
    // down to TARGET_COUNT before persisting.
    return coerceBundle(parsed, CANDIDATE_COUNT);
  } catch {
    return EMPTY_BUNDLE;
  }
}

function coerceBundle(
  value: unknown,
  limit = TARGET_COUNT,
): SuggestionsBundle {
  const out: SuggestionsBundle = { ...EMPTY_BUNDLE };
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!isLocale(k)) continue;
    if (!Array.isArray(v)) continue;
    out[k] = v
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && q.length <= 120)
      .slice(0, limit);
  }
  return out;
}
