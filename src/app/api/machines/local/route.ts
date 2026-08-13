// GET /api/machines/local?accountId=… — machines onboarded into Opti
// Assist that don't exist in the Optipeople portal (yet). The machine
// picker unions these with the portal's machine list, since the portal
// obviously can't return them.
//
// Requires an Optipeople bearer. Super admins and partners can query any
// account; everyone else (account admins, account users, operators) only
// their own — same 401/403 convention as the portal lists, so the picker
// treats failures uniformly.

import { getTranslations } from "next-intl/server";
import { AuthError, hasFullAccess, resolveCurrentUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LocalMachine = {
  id: string;
  name: string;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId")?.trim() ?? "";
  if (!accountId) {
    const t = await getTranslations("server");
    return Response.json(
      { error: t("missingField", { field: "accountId" }) },
      { status: 400 },
    );
  }

  try {
    const user = await resolveCurrentUser(req);
    if (!hasFullAccess(user.permissionName) && user.accountId !== accountId) {
      throw new AuthError(403, "Not authorised for this account");
    }
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("machine_id, display_name")
    .eq("account_id", accountId)
    .is("portal_machine_id", null)
    .order("display_name", { ascending: true });

  if (error) {
    console.error("GET /api/machines/local failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  const machines: LocalMachine[] = (data ?? []).map((row) => {
    const r = row as { machine_id: string; display_name: string | null };
    return { id: r.machine_id, name: r.display_name ?? r.machine_id };
  });

  return Response.json({ machines });
}
