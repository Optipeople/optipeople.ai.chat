// GET /api/admin/account-flags: the trial flag for every account that
// has one. Accounts not listed are paying, active customer accounts.
// Super admins and partners only.

import { getTranslations } from "next-intl/server";
import { listAccountFlags, type AccountFlags } from "@/lib/accountFlags";
import { AuthError, requireSuperAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type AccountFlagsListResponse = { flags: AccountFlags[] };

export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  try {
    const body: AccountFlagsListResponse = { flags: await listAccountFlags() };
    return Response.json(body);
  } catch (err) {
    console.error("account flags GET failed:", err);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}
