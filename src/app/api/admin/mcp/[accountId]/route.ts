// DELETE /api/admin/mcp/:accountId — remove an account's MCP config.
//
// We don't expose GET on this — admin UI uses the list endpoint and
// finds the row client-side. Adding GET here would tempt callers to
// read individual rows and we'd have to be careful not to leak the
// secret/refresh_token.

import { getTranslations } from "next-intl/server";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { deleteMcpConfig } from "@/lib/mcpConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(req: Request): Promise<Response | null> {
  try {
    await requireSuperAdmin(req);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { accountId } = await ctx.params;
  if (!accountId) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  try {
    await deleteMcpConfig(accountId);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("admin/mcp delete failed:", err);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}
