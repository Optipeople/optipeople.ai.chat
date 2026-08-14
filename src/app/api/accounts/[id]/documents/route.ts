// GET /api/accounts/[id]/documents
//
// Fleet-scope counterpart of /api/machines/[id]/documents: every
// operator-visible, ready document across all of the account's
// machines, each row carrying the machine's display name so the
// knowledge drawer can group per machine. Bearer auth only — fleet
// scope is unreachable from QR sessions, which are machine-pinned.
// Same trust model as /api/chat: a bearer user may query any accountId
// they hold (the portal token is the gate).

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import { getFleetMachines } from "@/lib/fleet";
import { getSupabaseServerClient } from "@/lib/supabase";
import type { OperatorDocument } from "@/app/api/machines/[id]/documents/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type FleetOperatorDocument = OperatorDocument & {
  machineId: string;
  machineName: string | null;
};

export type FleetDocumentsResponse = {
  documents: FleetOperatorDocument[];
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return Response.json({ error: "account id is required" }, { status: 400 });
  }

  try {
    await resolveCurrentUser(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const machines = await getFleetMachines(id);
  if (machines.length === 0) {
    const body: FleetDocumentsResponse = { documents: [] };
    return Response.json(body);
  }
  const nameById = new Map(machines.map((m) => [m.machineId, m.displayName]));

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, machine_id, title, summary, folder_path, source_type, page_count")
    .in(
      "machine_id",
      machines.map((m) => m.machineId),
    )
    .eq("operator_visible", true)
    .eq("status", "ready")
    .order("machine_id", { ascending: true })
    .order("folder_path", { ascending: true, nullsFirst: true })
    .order("title", { ascending: true });

  if (error) {
    console.error("fleet docs list failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const documents: FleetOperatorDocument[] = (data ?? []).map((d) => {
    const r = d as {
      id: string;
      machine_id: string;
      title: string;
      summary: string;
      folder_path: string | null;
      source_type: OperatorDocument["sourceType"];
      page_count: number | null;
    };
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      folderPath: r.folder_path ?? null,
      sourceType: r.source_type,
      pageCount: r.page_count,
      machineId: r.machine_id,
      machineName: nameById.get(r.machine_id) ?? null,
    };
  });

  const body: FleetDocumentsResponse = { documents };
  return Response.json(body);
}
