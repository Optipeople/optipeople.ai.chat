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

import Anthropic from "@anthropic-ai/sdk";
import { defaultLocale, isLocale, locales, type Locale } from "@/i18n/config";
import { getSupabaseServerClient } from "./supabase";

const MODEL = "claude-haiku-4-5-20251001";
// Pool size per language. The chat client picks 3 at random on load, so a
// larger pool means more variety across sessions.
const TARGET_COUNT = 10;
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

Produce EXACTLY ${TARGET_COUNT} questions in BOTH English and Danish. The same ${TARGET_COUNT} topics in each language — i.e. en[i] and da[i] cover the same question, just translated.

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
    `Generate ${TARGET_COUNT} short starter questions per language as the JSON object described.`,
  ].join("\n");

  const anthropic = new Anthropic();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = res.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  const bundle = parseBundleJson(text);
  await persistSuggestions(machineId, bundle);
  return bundle;
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
    return coerceBundle(parsed);
  } catch {
    return EMPTY_BUNDLE;
  }
}

function coerceBundle(value: unknown): SuggestionsBundle {
  const out: SuggestionsBundle = { ...EMPTY_BUNDLE };
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!isLocale(k)) continue;
    if (!Array.isArray(v)) continue;
    out[k] = v
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && q.length <= 120)
      .slice(0, TARGET_COUNT);
  }
  return out;
}
