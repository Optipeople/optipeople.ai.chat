// Fixed-taxonomy auto-organiser for a machine's knowledge base.
//
// Suggests a target folder for each document using Claude Haiku on the
// title + summary already stored on kb_documents. Returns proposals
// only — the caller (admin endpoint) shows them to the operator and
// applies the subset they confirm. Cheap by design: one LLM call per
// machine, summaries-only input, JSON output.
//
// The taxonomy is intentionally fixed and small — predictable buckets
// across machines beat free-form clustering. Folders mostly serve admin
// browsing, not retrieval, so the bar is "easier to scan", not "perfect
// semantic split".
//
// Server-only: uses the service-role Supabase client + Anthropic SDK.

import Anthropic from "@anthropic-ai/sdk";
import { ensureFolderPath } from "./ingestion";
import { getSupabaseServerClient } from "./supabase";
import { fromAnthropicUsage, recordUsage } from "./usage";

const MODEL = "claude-haiku-4-5-20251001";

// Cap the LLM input. A typical machine has <30 manuals; this is just
// belt-and-suspenders so a misconfigured customer can't blow our token
// budget on a single classify call.
const MAX_DOCS_PER_CALL = 120;

export type StandardFolder = {
  path: string;
  description: string;
};

export const STANDARD_FOLDERS: StandardFolder[] = [
  {
    path: "Opsætning",
    description:
      "Installation, ibrugtagning, kalibrering, indkøring af ny maskine",
  },
  {
    path: "Drift",
    description:
      "Daglig betjening, programmer, indstillinger under produktion, brugervejledning",
  },
  {
    path: "Vedligehold",
    description:
      "Smøring, service-intervaller, slidkontrol, forebyggende vedligehold",
  },
  {
    path: "Fejlfinding",
    description:
      "Alarmkoder, fejldiagnose, problemløsning, gendannelse efter stop",
  },
  {
    path: "Sikkerhed",
    description:
      "Sikkerhedsforskrifter, nødstop, beskyttelsesudstyr, CE og advarsler",
  },
  {
    path: "Reservedele",
    description:
      "Reservedelsdiagrammer, dele-numre, datablade, tekniske specifikationer",
  },
];

const STANDARD_PATHS = new Set(STANDARD_FOLDERS.map((f) => f.path));

export type AutoOrganizeCandidate = {
  id: string;
  title: string;
  summary: string;
  currentFolder: string | null;
};

export type AutoOrganizeProposal = {
  id: string;
  title: string;
  summary: string;
  currentFolder: string | null;
  proposedFolder: string | null;
};

// Public: load candidates (status='ready' docs) and ask Claude to assign
// each to one of STANDARD_FOLDERS or null (= unclassified, leave alone).
// Returns an empty array on any LLM failure — the dialog surfaces that
// as "no proposals", which is the right thing to do for an opt-in tool.
export async function proposeAutoOrganize(
  machineId: string,
): Promise<{ proposals: AutoOrganizeProposal[]; folders: StandardFolder[] }> {
  const supabase = getSupabaseServerClient();

  const { data: docs, error } = await supabase
    .from("kb_documents")
    .select("id, title, summary, folder_path")
    .eq("machine_id", machineId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(MAX_DOCS_PER_CALL);

  if (error) {
    throw new Error(`autoOrganize: kb_documents read failed: ${error.message}`);
  }

  const candidates: AutoOrganizeCandidate[] = (docs ?? []).map((d) => {
    const r = d as {
      id: string;
      title: string | null;
      summary: string | null;
      folder_path: string | null;
    };
    return {
      id: r.id,
      title: (r.title ?? "").trim() || "(uden titel)",
      summary: (r.summary ?? "").trim() || "(ingen beskrivelse)",
      currentFolder: r.folder_path ?? null,
    };
  });

  if (candidates.length === 0) {
    return { proposals: [], folders: STANDARD_FOLDERS };
  }

  const assignments = await classifyWithClaude(machineId, candidates);

  // Default to "leave alone" (proposedFolder = currentFolder) when the
  // model didn't return a row for a given id, or returned an unknown
  // folder name. The UI filters out no-ops before showing the preview.
  const byId = new Map(assignments.map((a) => [a.id, a.folder]));
  const proposals: AutoOrganizeProposal[] = candidates.map((c) => {
    const folder = byId.get(c.id);
    const proposed =
      folder && STANDARD_PATHS.has(folder) ? folder : c.currentFolder;
    return {
      id: c.id,
      title: c.title,
      summary: c.summary,
      currentFolder: c.currentFolder,
      proposedFolder: proposed,
    };
  });

  return { proposals, folders: STANDARD_FOLDERS };
}

export type AutoOrganizeMove = {
  id: string;
  folder: string;
};

// Public: apply a confirmed subset of moves. Each move's target folder
// is ensured to exist in kb_folders first so the tree view shows it
// even if the document later gets deleted. Returns the count actually
// updated.
export async function applyAutoOrganize(
  machineId: string,
  moves: AutoOrganizeMove[],
): Promise<{ applied: number }> {
  const valid = moves
    .filter(
      (m) =>
        typeof m.id === "string" &&
        typeof m.folder === "string" &&
        STANDARD_PATHS.has(m.folder),
    )
    .slice(0, MAX_DOCS_PER_CALL);

  if (valid.length === 0) return { applied: 0 };

  const folders = Array.from(new Set(valid.map((m) => m.folder)));
  for (const f of folders) {
    await ensureFolderPath(machineId, f);
  }

  const supabase = getSupabaseServerClient();
  let applied = 0;
  for (const move of valid) {
    const { error } = await supabase
      .from("kb_documents")
      .update({ folder_path: move.folder })
      .eq("id", move.id)
      .eq("machine_id", machineId);
    if (error) {
      console.warn(
        `autoOrganize: failed to move doc=${move.id} → ${move.folder}:`,
        error.message,
      );
      continue;
    }
    applied++;
  }

  return { applied };
}

const SYSTEM_PROMPT = `You classify documents for an operator knowledge base for wood-industry machines.

You receive a list of folders and a list of documents (title + short description). Suggest which folder each document best belongs to.

Rules:
- Pick EXACTLY one of the available folders, or null if you are not sure.
- Set folder to null if the document does not clearly fit any folder — it is better to leave a document alone than to guess.
- A document that covers several areas goes in the most specific folder (alarms → Fejlfinding, not Drift).
- Maintenance plans → Vedligehold. Alarm codes / troubleshooting → Fejlfinding. Safety data sheets / CE → Sikkerhed. Spare-parts lists / datasheets → Reservedele.
- The folder names ("Opsætning", "Drift", "Vedligehold", "Fejlfinding", "Sikkerhed", "Reservedele") are fixed identifiers — use them verbatim regardless of the document language.

Return EXACTLY a JSON array with one object per document: [{"id": "...", "folder": "Vedligehold"}, ...]. Nothing else — no explanation, no markdown, just the array.`;

type Assignment = { id: string; folder: string | null };

async function classifyWithClaude(
  machineId: string,
  candidates: AutoOrganizeCandidate[],
): Promise<Assignment[]> {
  const folderList = STANDARD_FOLDERS.map(
    (f) => `- ${f.path}: ${f.description}`,
  ).join("\n");

  const docList = candidates
    .map((c) => {
      const current = c.currentFolder ? c.currentFolder : "root";
      return `(id=${c.id}) "${truncate(c.title, 160)}" — ${truncate(c.summary, 300)} [current: ${current}]`;
    })
    .join("\n");

  const userPrompt = [
    "Available folders:",
    folderList,
    "",
    `Documents to classify (${candidates.length}):`,
    docList,
    "",
    "Return the JSON array now.",
  ].join("\n");

  const anthropic = new Anthropic();
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: Math.min(4000, 80 + candidates.length * 40),
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  await recordUsage({
    machineId,
    provider: "anthropic",
    model: MODEL,
    operation: "auto_organize",
    ...fromAnthropicUsage(res.usage),
  });

  const text = res.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return parseAssignmentsJson(text);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// Same defensive parsing as suggestions.ts — Haiku occasionally wraps
// the array in a ```json fence or prefixes a sentence even when told
// not to.
function parseAssignmentsJson(text: string): Assignment[] {
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
    const out: Assignment[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const id = (item as { id?: unknown }).id;
      const folder = (item as { folder?: unknown }).folder;
      if (typeof id !== "string") continue;
      if (typeof folder === "string") {
        out.push({ id, folder });
      } else if (folder === null) {
        out.push({ id, folder: null });
      }
    }
    return out;
  } catch {
    return [];
  }
}
