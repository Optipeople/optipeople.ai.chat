// PATCH /api/admin/insights/[id]  review one distilled insight.
//   Body: {
//     action: "approve" | "reject" | "save",
//     title?, problem?, cause?, solution?: string,
//     facts?: string[],
//   }
//
//   save:    updates the editable fields only. Status is unchanged.
//   approve: saves the edits, publishes the insight into the machine's KB
//            (publishInsight, which sets status 'published' and links
//            promoted_doc_id), then stamps reviewed_by/reviewed_at.
//   reject:  status 'rejected' + reviewed_by/reviewed_at. If the insight
//            was already published (auto-published by the distiller, or
//            approved earlier), its KB document is deleted so the
//            knowledge leaves the KB too.
//
// Access is checked against the insight's machine, the same check the
// machine routes use.

import { getTranslations } from "next-intl/server";
import {
  assertMachineAccess,
  AuthError,
  requireAdmin,
  type Admin,
} from "@/lib/auth";
import { publishInsight } from "@/lib/distill";
import { getSupabaseServerClient } from "@/lib/supabase";
import {
  INSIGHT_SELECT_COLS,
  toAdminInsight,
  type AdminInsight,
  type AdminInsightRow,
} from "@/app/api/admin/insights/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Approving embeds the document (one Voyage call), well inside this.
export const maxDuration = 60;

export type AdminInsightAction = "approve" | "reject" | "save";

export type AdminInsightPatchResponse = { insight: AdminInsight };

const ACTIONS: readonly AdminInsightAction[] = ["approve", "reject", "save"];
const TEXT_MAX = 4000;
const FACTS_MAX = 50;

type Edits = Partial<{
  title: string;
  problem: string;
  cause: string;
  solution: string;
  facts: string[];
}>;

// Returns null when a provided field has the wrong type.
function parseEdits(body: Record<string, unknown>): Edits | null {
  const edits: Edits = {};
  for (const key of ["title", "problem", "cause", "solution"] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v !== "string") return null;
    edits[key] = v.trim().slice(0, TEXT_MAX);
  }
  if (body.facts !== undefined) {
    if (!Array.isArray(body.facts) || body.facts.some((f) => typeof f !== "string")) {
      return null;
    }
    edits.facts = (body.facts as string[])
      .map((f) => f.trim().slice(0, TEXT_MAX))
      .filter((f) => f.length > 0)
      .slice(0, FACTS_MAX);
  }
  return edits;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let admin: Admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const t = await getTranslations("server");

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }
  const action = ACTIONS.includes(body.action as AdminInsightAction)
    ? (body.action as AdminInsightAction)
    : null;
  const edits = parseEdits(body);
  if (!action || !edits) {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  const { data: found, error: lookupErr } = await supabase
    .from("kb_insights")
    .select(INSIGHT_SELECT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) {
    console.error("admin insight lookup failed:", lookupErr);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
  if (!found) {
    return Response.json({ error: t("notFound") }, { status: 404 });
  }
  const row = found as unknown as AdminInsightRow;

  try {
    await assertMachineAccess(admin, row.machine_id);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const now = new Date().toISOString();
  const reviewer = admin.email || admin.userId;

  if (action === "reject") {
    if (row.promoted_doc_id) {
      // kb_insights.promoted_doc_id (and feedback.promoted_doc_id) are
      // on delete set null, so the links clear themselves.
      const { error: delErr } = await supabase
        .from("kb_documents")
        .delete()
        .eq("id", row.promoted_doc_id);
      if (delErr) {
        console.error("admin insight reject: KB document delete failed:", delErr);
        return Response.json({ error: t("dbError") }, { status: 500 });
      }
    }
    const { error } = await supabase
      .from("kb_insights")
      .update({
        status: "rejected",
        promoted_doc_id: null,
        reviewed_by: reviewer,
        reviewed_at: now,
        updated_at: now,
      })
      .eq("id", id);
    if (error) {
      console.error("admin insight reject failed:", error);
      return Response.json({ error: t("dbError") }, { status: 500 });
    }
  } else {
    if (Object.keys(edits).length > 0) {
      const { error } = await supabase
        .from("kb_insights")
        .update({ ...edits, updated_at: now })
        .eq("id", id);
      if (error) {
        console.error("admin insight save failed:", error);
        return Response.json({ error: t("dbError") }, { status: 500 });
      }
    }

    if (action === "approve") {
      const merged = {
        title: edits.title ?? row.title,
        problem: edits.problem ?? row.problem,
        cause: edits.cause ?? row.cause,
        solution: edits.solution ?? row.solution,
        facts: edits.facts ?? row.facts ?? [],
      };
      try {
        await publishInsight({
          insightId: row.id,
          conversationId: row.conversation_id,
          machineId: row.machine_id,
          ...merged,
          createdBy: reviewer,
        });
      } catch (err) {
        console.error(
          "admin insight publish failed:",
          err instanceof Error ? err.message : err,
        );
        return Response.json({ error: t("dbError") }, { status: 500 });
      }
      const { error } = await supabase
        .from("kb_insights")
        .update({ reviewed_by: reviewer, reviewed_at: now, updated_at: now })
        .eq("id", id);
      if (error) {
        console.error("admin insight review stamp failed:", error);
        return Response.json({ error: t("dbError") }, { status: 500 });
      }
    }
  }

  const { data: updated, error: readErr } = await supabase
    .from("kb_insights")
    .select(INSIGHT_SELECT_COLS)
    .eq("id", id)
    .single();
  if (readErr || !updated) {
    console.error("admin insight re-read failed:", readErr);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  const result: AdminInsightPatchResponse = {
    insight: toAdminInsight(updated as unknown as AdminInsightRow),
  };
  return Response.json(result);
}
