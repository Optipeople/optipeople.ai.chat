// Feedback → KB promotion.
//
// When an operator marks a chat as resolved and supplies a solution_text,
// we promote that answer into the same machine's knowledge base as a
// kb_documents row of source_type='feedback'. The next operator with the
// same problem then retrieves it via search_kb alongside the manuals.
//
// Auto-promote, admin-demote: any super-admin can delete the resulting
// document from the existing admin tree. The feedback table's
// promoted_doc_id is `on delete set null`, so demotion leaves the
// operator's verdict intact while removing the KB chunk.

import { randomUUID } from "node:crypto";
import { chunkText, ensureFolderPath } from "./ingestion";
import { getSupabaseServerClient } from "./supabase";
import { embedDocuments, VOYAGE_MODEL } from "./voyage";

const TITLE_MAX = 80;
const SUMMARY_MAX = 200;
// Auto-promoted feedback docs live in their own folder so the tree's
// root stays readable as the count grows. Stable constant: renaming it
// would orphan existing rows in the old folder.
export const FEEDBACK_FOLDER = "Experience";

export type PromoteFeedbackInput = {
  feedbackId: string;
  conversationId: string;
  machineId: string;
  solutionText: string;
  createdBy: string;
};

// Pulls the first user turn from a conversation so we can frame the
// feedback chunk as Q&A — vastly better retrieval than embedding the
// solution alone, since the operator's question is what the next user
// will type.
async function fetchFirstUserQuestion(
  conversationId: string,
): Promise<string | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("promoteFeedback: first-user-question lookup failed:", error);
    return null;
  }
  const content = (data as { content?: string } | null)?.content ?? null;
  return content && content.trim() ? content.trim() : null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// Promote a feedback row into kb_documents + kb_chunks. Returns the new
// document id on success. Throws on any failure — caller decides whether
// to surface the error to the operator or just log it.
export async function promoteFeedbackToKb(
  input: PromoteFeedbackInput,
): Promise<string> {
  const supabase = getSupabaseServerClient();

  const question = await fetchFirstUserQuestion(input.conversationId);
  const titleCore = question ?? input.solutionText;
  const title = `Operatørerfaring: ${truncate(titleCore.replace(/\s+/g, " "), TITLE_MAX)}`;
  const summary = truncate(input.solutionText.replace(/\s+/g, " "), SUMMARY_MAX);

  // Frame as Q&A so the embedding captures both the problem statement
  // and the solution. Question first because the next operator's query
  // resembles the question, not the answer.
  const chunkContent = question
    ? `Spørgsmål fra operatør:\n${question}\n\nLøsning (markeret som virkende af operatøren):\n${input.solutionText}`
    : `Løsning fra operatør (markeret som virkende):\n${input.solutionText}`;

  const documentId = randomUUID();

  // Make sure the dedicated folder exists in kb_folders before the doc
  // references it — otherwise the tree won't render the folder until
  // someone manually re-creates it.
  await ensureFolderPath(input.machineId, FEEDBACK_FOLDER);

  const { error: docErr } = await supabase.from("kb_documents").insert({
    id: documentId,
    machine_id: input.machineId,
    title,
    summary,
    source_type: "feedback",
    storage_path: null,
    byte_size: null,
    page_count: null,
    status: "ready",
    created_by: input.createdBy,
    folder_path: FEEDBACK_FOLDER,
  });
  if (docErr) {
    throw new Error(`promote: kb_documents insert failed: ${docErr.message}`);
  }

  const chunks = chunkText(chunkContent);
  // Solution text is short by construction; embedDocuments handles the
  // single-chunk case fine and we get one Voyage call here.
  const embeddings = await embedDocuments(chunks);
  if (embeddings.length !== chunks.length) {
    // Roll back the doc row so we don't leave an empty document hanging.
    await supabase.from("kb_documents").delete().eq("id", documentId);
    throw new Error(
      `promote: embedding count mismatch (${embeddings.length} vs ${chunks.length})`,
    );
  }

  const rows = chunks.map((text, i) => ({
    document_id: documentId,
    machine_id: input.machineId,
    ordinal: i,
    page_from: null,
    page_to: null,
    text,
    embedding: embeddings[i],
    embedding_model: VOYAGE_MODEL,
  }));

  const { error: chunkErr } = await supabase.from("kb_chunks").insert(rows);
  if (chunkErr) {
    await supabase.from("kb_documents").delete().eq("id", documentId);
    throw new Error(`promote: kb_chunks insert failed: ${chunkErr.message}`);
  }

  const { error: linkErr } = await supabase
    .from("feedback")
    .update({ promoted_doc_id: documentId })
    .eq("id", input.feedbackId);
  if (linkErr) {
    // The document is in the KB; failing to link the feedback row is
    // a soft error. Log and move on — admin can still demote via the
    // tree, and re-submission will replace the doc.
    console.warn("promote: feedback link failed:", linkErr);
  }

  return documentId;
}
