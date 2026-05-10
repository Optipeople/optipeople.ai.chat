// POST   /api/admin/machines/[id]/qr — generate (or regenerate) a QR
//                                       access token for the machine.
// DELETE /api/admin/machines/[id]/qr — revoke the current token.
//
// One token per machine, stored on machine_kb. Rotating means writing a
// new random value; revoking sets it back to NULL. Tokens never expire
// on their own — the assumption is that QR stickers live on physical
// machines and shouldn't go dark unannounced.

import { randomBytes } from "node:crypto";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AdminQrTokenResponse = {
  token: string | null;
  createdAt: string | null;
};

// 24 random bytes → 32-char base64url. Long enough that brute-force is
// not a concern; short enough that the resulting URL stays QR-friendly
// at moderate print sizes.
function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

async function gate(req: Request): Promise<Response | null> {
  try {
    await requireSuperAdmin(req);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const supabase = getSupabaseServerClient();

  const token = mintToken();
  const createdAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("machine_kb")
    .update({ qr_token: token, qr_token_created_at: createdAt })
    .eq("machine_id", id)
    .select("qr_token, qr_token_created_at")
    .maybeSingle();

  if (error) {
    console.error("admin qr POST failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Machine not found" }, { status: 404 });
  }

  const row = data as { qr_token: string; qr_token_created_at: string };
  const result: AdminQrTokenResponse = {
    token: row.qr_token,
    createdAt: row.qr_token_created_at,
  };
  return Response.json(result);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("machine_kb")
    .update({ qr_token: null, qr_token_created_at: null })
    .eq("machine_id", id);

  if (error) {
    console.error("admin qr DELETE failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
