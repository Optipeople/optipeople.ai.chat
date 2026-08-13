// GET  /api/admin/machines — list every known machine_kb row with its
//                            ready-document count. Account admins see
//                            only machines for their own account.
// POST /api/admin/machines — create a new machine_kb row, either from
//                            an Optipeople machine the admin picked
//                            (machineId set) or as a local-only machine
//                            that isn't in the portal yet (machineId
//                            omitted, displayName required — used by the
//                            New account wizard). Account admins can
//                            only create within their own account.

import { getTranslations } from "next-intl/server";
import {
  assertAccountAccess,
  AuthError,
  requireAdmin,
  type Admin,
} from "@/lib/auth";
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

async function gate(
  req: Request,
): Promise<{ admin: Admin | null; denied: Response | null }> {
  try {
    const admin = await requireAdmin(req);
    return { admin, denied: null };
  } catch (err) {
    if (err instanceof AuthError) return { admin: null, denied: err.toResponse() };
    throw err;
  }
}

export async function GET(req: Request) {
  const { admin, denied } = await gate(req);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();

  // Account admins see only their account's machines. Super admins
  // see everything.
  const machinesQuery = supabase
    .from("machine_kb")
    .select("machine_id, account_id, display_name, updated_at")
    .order("updated_at", { ascending: false });
  if (admin!.role === "account") {
    machinesQuery.eq("account_id", admin!.accountId);
  }

  const [{ data: machines, error: mErr }, { data: docs, error: dErr }] =
    await Promise.all([
      machinesQuery,
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
  const { admin, denied } = await gate(req);
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

  // Without a portal machine to inherit a name from, a local machine
  // must at least bring its own display name.
  const isLocal = !machineId;
  if (!accountId || (isLocal && !displayName)) {
    return Response.json(
      { error: t("admin.machineFieldsRequired") },
      { status: 400 },
    );
  }
  // Account admins may only seed machines within their own account.
  try {
    assertAccountAccess(admin!, accountId);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const supabase = getSupabaseServerClient();

  if (!isLocal) {
    // The portal machine may already be onboarded either as the primary
    // key (classic onboarding) or as the link target of a local machine.
    const [{ data: byId }, { data: byPortalId }] = await Promise.all([
      supabase
        .from("machine_kb")
        .select("machine_id")
        .eq("machine_id", machineId)
        .maybeSingle(),
      supabase
        .from("machine_kb")
        .select("machine_id")
        .eq("portal_machine_id", machineId)
        .maybeSingle(),
    ]);
    if (byId || byPortalId) {
      return Response.json(
        { error: t("admin.machineAlreadyExists") },
        { status: 409 },
      );
    }
  }

  const { data, error } = await supabase
    .from("machine_kb")
    .insert({
      // Local machines get a generated id; portal machines keep the
      // Optipeople id as their local id (unchanged behaviour) and record
      // it in portal_machine_id too so MCP scoping reads one column.
      machine_id: isLocal ? `local-${crypto.randomUUID()}` : machineId,
      portal_machine_id: isLocal ? null : machineId,
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
