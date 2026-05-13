// Per-machine starter-question generator.
//
// Runs after KB content changes (ingest, reprocess, reset, document
// delete) and stashes 3 short Danish questions on machine_kb. The chat
// empty state reads them on session start; an empty array means the UI
// falls back to broad generic prompts.
//
// Cheap by design — we feed only document summaries (already on the
// kb_documents row) plus the machine display name, so the prompt stays
// well under a couple of thousand tokens even with dozens of manuals.

import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseServerClient } from "./supabase";

const MODEL = "claude-haiku-4-5-20251001";
// A pool of candidates. The chat client picks 3 at random and rotates
// one every few seconds while the empty state is visible, so a larger
// pool means more variety per visit. Haiku produces all of them in a
// single call so cost is still negligible.
const TARGET_COUNT = 10;
const MAX_DOC_SUMMARIES = 30;

const SYSTEM_PROMPT = `You generate short starter questions for a chat assistant used by operators of wood-industry machines.

The operator is at the machine and wants fast, concrete answers from the manual. Your questions must be:
- Written in the same language the manuals are written in (detect the language from the document summaries below). Use plain, everyday phrasing — operators stand on the factory floor.
- Short — at most 8 words each.
- Concrete and different — avoid overlap. Aim for breadth across these areas: alarms / error codes, daily operation, maintenance schedules, settings & calibration, troubleshooting, safety. Don't repeat the same topic twice.
- Grounded in the machine's actual manual content. Use ONLY alarm codes, button names, or components that explicitly appear in the manual extracts below — never invent codes or names.
- Technical terms, alarm codes, and button names stay in the original language as they appear in the manual.

Return EXACTLY ${TARGET_COUNT} questions as a JSON array of strings. Nothing else — no explanation, no markdown, just the array.`;

type DocSummaryRow = {
  title: string | null;
  summary: string | null;
};

type MachineKbHead = {
  display_name: string | null;
};

export async function regenerateSuggestedQuestions(
  machineId: string,
): Promise<string[]> {
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

  // Empty KB → store empty array. UI falls back to broad generic prompts
  // client-side. No LLM call needed.
  if (ready.length === 0) {
    await persistSuggestions(machineId, []);
    return [];
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
    `Machine manuals (${ready.length} documents):`,
    "",
    corpus,
    "",
    `Generate ${TARGET_COUNT} short starter questions as a JSON array.`,
  ].join("\n");

  const anthropic = new Anthropic();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = res.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  const parsed = parseQuestionsJson(text);
  const cleaned = parsed
    .map((q) => q.trim())
    .filter((q) => q.length > 0 && q.length <= 120)
    .slice(0, TARGET_COUNT);

  await persistSuggestions(machineId, cleaned);
  return cleaned;
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
): Promise<string[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("suggested_questions")
    .eq("machine_id", machineId)
    .maybeSingle<{ suggested_questions: string[] | null }>();
  if (error) {
    console.warn(
      `suggestions: read failed for machine=${machineId}:`,
      error.message,
    );
    return [];
  }
  return data?.suggested_questions ?? [];
}

async function persistSuggestions(
  machineId: string,
  questions: string[],
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("machine_kb")
    .update({
      suggested_questions: questions,
      suggestions_updated_at: new Date().toISOString(),
    })
    .eq("machine_id", machineId);
  if (error) {
    throw new Error(`suggestions: persist failed: ${error.message}`);
  }
}

// The model is instructed to return a bare JSON array, but Haiku
// occasionally wraps it in a ```json fence or prefixes a sentence. Strip
// fences and locate the first `[...]` block before parsing.
function parseQuestionsJson(text: string): string[] {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string");
  } catch {
    return [];
  }
}
