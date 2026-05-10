// GET /api/admin/machines — list every known machine_kb row with its
// ready-document count. Gated on Optipeople SuperAdministrator.

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminMachine = {
  machineId: string;
  accountId: string;
  displayName: string | null;
  documentCount: number;
  updatedAt: string;
};

export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const supabase = getSupabaseServerClient();

  const [{ data: machines, error: mErr }, { data: docs, error: dErr }] =
    await Promise.all([
      supabase
        .from("machine_kb")
        .select("machine_id, account_id, display_name, updated_at")
        .order("updated_at", { ascending: false }),
      supabase.from("kb_documents").select("machine_id").eq("status", "ready"),
    ]);

  if (mErr || dErr) {
    console.error("admin/machines query failed:", mErr, dErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const d of docs ?? []) {
    const id = (d as { machine_id: string }).machine_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const result: AdminMachine[] = (machines ?? []).map((m) => {
    const row = m as {
      machine_id: string;
      account_id: string;
      display_name: string | null;
      updated_at: string;
    };
    return {
      machineId: row.machine_id,
      accountId: row.account_id,
      displayName: row.display_name,
      documentCount: counts.get(row.machine_id) ?? 0,
      updatedAt: row.updated_at,
    };
  });

  return Response.json({ machines: result });
}
