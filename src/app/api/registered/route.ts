// GET /api/registered — public lookup of which Optipeople accounts and
// machines have been onboarded to this Opti Assist instance via
// machine_kb. Used by the login flow to filter the pickers down to
// machines this app actually serves.
//
// IDs only — no display names or knowledge-base details — so we don't
// need authentication. The same IDs are already exposed in QR stickers.

import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type RegisteredResponse = {
  accountIds: string[];
  machineIds: string[];
};

export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("machine_id, account_id");

  if (error) {
    console.error("GET /api/registered failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const accountIds = new Set<string>();
  const machineIds = new Set<string>();
  for (const row of data ?? []) {
    const r = row as { machine_id: string; account_id: string };
    accountIds.add(r.account_id);
    machineIds.add(r.machine_id);
  }

  const result: RegisteredResponse = {
    accountIds: Array.from(accountIds),
    machineIds: Array.from(machineIds),
  };
  return Response.json(result);
}
