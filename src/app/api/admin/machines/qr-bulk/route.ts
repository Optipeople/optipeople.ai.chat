// POST /api/admin/machines/qr-bulk: { machineIds } (max 500)
//
// Bulk print of named stickers for existing machines. Mints a
// machine_kb.qr_token for every listed machine that lacks one and
// returns the token for all of them, in request order. Existing tokens
// are never rotated, so stickers already on machines keep working.
//
// Same scoping as /api/admin/machines/[id]/qr, applied to every id:
// 404 if any machine is unknown, 403 if any belongs to another account.
// Nothing is minted unless every id passes.

import { randomBytes } from "node:crypto";
import { assertAccountAccess, AuthError, requireAdmin } from "@/lib/auth";
import type { BulkMachineQrResponse } from "@/lib/qrStickerTypes";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MACHINES = 500;
// Keeps each PostgREST in.(...) filter well inside URL length limits.
const LOOKUP_CHUNK = 100;
// Concurrent token updates; enough to be quick without a burst of 500.
const MINT_CONCURRENCY = 20;

// Same format as /api/admin/machines/[id]/qr: 24 random bytes, 32-char
// base64url.
function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

type MachineRow = {
  machine_id: string;
  account_id: string;
  display_name: string | null;
  qr_token: string | null;
};

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  let body: { machineIds?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.machineIds;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !v)) {
    return Response.json(
      { error: "machineIds must be an array of machine ids" },
      { status: 400 },
    );
  }
  const machineIds = [...new Set(raw as string[])];
  if (machineIds.length === 0) {
    const empty: BulkMachineQrResponse = { machines: [] };
    return Response.json(empty);
  }
  if (machineIds.length > MAX_MACHINES) {
    return Response.json(
      { error: `At most ${MAX_MACHINES} machines per request` },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const byId = new Map<string, MachineRow>();
  for (let i = 0; i < machineIds.length; i += LOOKUP_CHUNK) {
    const { data, error } = await supabase
      .from("machine_kb")
      .select("machine_id, account_id, display_name, qr_token")
      .in("machine_id", machineIds.slice(i, i + LOOKUP_CHUNK));
    if (error) {
      console.error("admin qr-bulk lookup failed:", error);
      return Response.json({ error: "Database error" }, { status: 500 });
    }
    for (const r of (data ?? []) as MachineRow[]) byId.set(r.machine_id, r);
  }

  try {
    for (const id of machineIds) {
      const row = byId.get(id);
      if (!row) throw new AuthError(404, `Machine not found: ${id}`);
      assertAccountAccess(admin, row.account_id);
    }
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const missing = machineIds.filter((id) => !byId.get(id)!.qr_token);
  for (let i = 0; i < missing.length; i += MINT_CONCURRENCY) {
    const results = await Promise.all(
      missing.slice(i, i + MINT_CONCURRENCY).map(async (id) => {
        // Only fill an empty slot: if someone minted a token for this
        // machine meanwhile, keep theirs.
        const { data, error } = await supabase
          .from("machine_kb")
          .update({
            qr_token: mintToken(),
            qr_token_created_at: new Date().toISOString(),
          })
          .eq("machine_id", id)
          .is("qr_token", null)
          .select("qr_token")
          .maybeSingle();
        if (error) return { id, error };
        if (data) return { id, token: (data as { qr_token: string }).qr_token };
        const reread = await supabase
          .from("machine_kb")
          .select("qr_token")
          .eq("machine_id", id)
          .maybeSingle();
        if (reread.error) return { id, error: reread.error };
        const token = (reread.data as { qr_token: string | null } | null)
          ?.qr_token;
        return token ? { id, token } : { id, error: "token vanished" };
      }),
    );
    for (const r of results) {
      if ("error" in r) {
        console.error(`admin qr-bulk mint failed for ${r.id}:`, r.error);
        return Response.json({ error: "Database error" }, { status: 500 });
      }
      byId.get(r.id)!.qr_token = r.token;
    }
  }

  const result: BulkMachineQrResponse = {
    machines: machineIds.map((id) => {
      const row = byId.get(id)!;
      return {
        machineId: row.machine_id,
        displayName: row.display_name,
        token: row.qr_token!,
      };
    }),
  };
  return Response.json(result);
}
