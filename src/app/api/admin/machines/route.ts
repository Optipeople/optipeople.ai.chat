// GET  /api/admin/machines — list every known machine_kb row with its
//                            ready-document count.
// POST /api/admin/machines — create a new machine_kb row from an
//                            Optipeople machine the admin picked.
// Gated on Optipeople SuperAdministrator.

import { getTranslations } from "next-intl/server";
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

async function gate(req: Request): Promise<Response | null> {
  try {
    await requireSuperAdmin(req);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function GET(req: Request) {
  const denied = await gate(req);
  if (denied) return denied;

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
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
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

export async function POST(req: Request) {
  const denied = await gate(req);
  if (denied) return denied;

  const t = await getTranslations("server");

  let body: { machineId?: unknown; accountId?: unknown; displayName?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const machineId =
    typeof body.machineId === "string" ? body.machineId.trim() : "";
  const accountId =
    typeof body.accountId === "string" ? body.accountId.trim() : "";
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim().length > 0
      ? body.displayName.trim()
      : null;

  if (!machineId || !accountId) {
    return Response.json(
      { error: t("admin.machineFieldsRequired") },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  const { data: existing } = await supabase
    .from("machine_kb")
    .select("machine_id")
    .eq("machine_id", machineId)
    .maybeSingle();
  if (existing) {
    return Response.json(
      { error: t("admin.machineAlreadyExists") },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("machine_kb")
    .insert({
      machine_id: machineId,
      account_id: accountId,
      display_name: displayName,
    })
    .select("machine_id, account_id, display_name, updated_at")
    .single();

  if (error || !data) {
    console.error("admin POST machine failed:", error);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  const row = data as {
    machine_id: string;
    account_id: string;
    display_name: string | null;
    updated_at: string;
  };
  const result: AdminMachine = {
    machineId: row.machine_id,
    accountId: row.account_id,
    displayName: row.display_name,
    documentCount: 0,
    updatedAt: row.updated_at,
  };
  return Response.json({ machine: result }, { status: 201 });
}
