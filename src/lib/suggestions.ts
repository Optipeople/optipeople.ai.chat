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
const TARGET_COUNT = 3;
const MAX_DOC_SUMMARIES = 30;

const SYSTEM_PROMPT = `Du genererer korte starter-spørgsmål til en chat-assistent for operatører af træindustri-maskiner.

Operatøren står ved maskinen og vil have hurtige, konkrete svar fra manualen. Dine spørgsmål skal være:
- På dansk, hverdagsligt sprog (operatørerne står på fabriksgulvet).
- Korte — maksimalt 8 ord hver.
- Konkrete og forskellige — undgå overlap. Dæk forskellige områder: alarmer, procedurer, vedligehold, indstillinger, fejlfinding.
- Forankret i maskinens faktiske manual-indhold. Hvis manualen nævner en specifik alarmkode, knap eller komponent, så brug den.
- Tekniske termer, alarmkoder og knapnavne forbliver på originalsproget (f.eks. "Alarm 731", "M06", "RESET").

Du skal returnere PRÆCIS ${TARGET_COUNT} spørgsmål som et JSON-array af strenge. Intet andet — ingen forklaring, ingen markdown, kun arrayet.`;

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
      const title = d.title?.trim() || `Dokument ${i + 1}`;
      const summary = d.summary?.trim() || "(ingen beskrivelse)";
      return `[${i + 1}] ${title}\n${summary}`;
    })
    .join("\n\n");

  const userPrompt = [
    machineName
      ? `Maskinens navn: ${machineName}`
      : "Maskinens navn er ikke angivet.",
    "",
    `Maskinens manualer (${ready.length} dokumenter):`,
    "",
    corpus,
    "",
    `Generér ${TARGET_COUNT} korte starter-spørgsmål som JSON-array.`,
  ].join("\n");

  const anthropic = new Anthropic();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
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
