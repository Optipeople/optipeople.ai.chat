// Fleet scope: resolves the set of machines an account-wide ("all
// machines") conversation spans. Source of truth is machine_kb — every
// machine onboarded into Opti Assist for the account, portal-linked or
// wizard-created. This one list drives the fleet system-prompt roster,
// the search_kb_multi machine array, and machine_id validation on tool
// calls, so they can never drift apart.
//
// Server-only (service-role Supabase client).

import { getSupabaseServerClient } from "./supabase";

export type FleetMachine = {
  machineId: string;
  displayName: string | null;
  // Optipeople portal id — null for wizard-created machines an admin
  // hasn't linked yet. MCP data tools can only be scoped to linked
  // machines; unlinked ones are KB-only.
  portalMachineId: string | null;
  // Ready, operator-visible manuals. Shown in the prompt roster so the
  // model knows which machines actually have something to search.
  docCount: number;
};

export async function getFleetMachines(
  accountId: string,
): Promise<FleetMachine[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("machine_id, display_name, portal_machine_id")
    .eq("account_id", accountId)
    .order("display_name", { ascending: true, nullsFirst: false });
  if (error) throw error;

  const rows = (data ?? []) as {
    machine_id: string;
    display_name: string | null;
    portal_machine_id: string | null;
  }[];
  if (rows.length === 0) return [];

  // Ready-doc counts, aggregated here — one narrow query instead of a
  // per-machine count round trip. Accounts hold tens of machines, not
  // thousands, so pulling the machine_id column is cheap.
  const counts = new Map<string, number>();
  const { data: docs, error: docsError } = await supabase
    .from("kb_documents")
    .select("machine_id")
    .in(
      "machine_id",
      rows.map((r) => r.machine_id),
    )
    .eq("status", "ready");
  if (docsError) {
    // Counts are prompt garnish — a lookup failure shouldn't kill the
    // chat. Roster ships with zeros and the model falls back to trying
    // search_kb directly.
    console.error("getFleetMachines: doc count query failed:", docsError);
  } else {
    for (const d of (docs ?? []) as { machine_id: string }[]) {
      counts.set(d.machine_id, (counts.get(d.machine_id) ?? 0) + 1);
    }
  }

  return rows.map((r) => ({
    machineId: r.machine_id,
    displayName: r.display_name,
    portalMachineId: r.portal_machine_id,
    docCount: counts.get(r.machine_id) ?? 0,
  }));
}

// Resolve a model-supplied machine_id (which may be either our internal
// id or the Optipeople portal id — models mix them up) against the
// fleet set. Returns null when it matches nothing.
export function resolveFleetMachine(
  machines: FleetMachine[],
  id: string,
): FleetMachine | null {
  return (
    machines.find((m) => m.machineId === id) ??
    machines.find((m) => m.portalMachineId === id) ??
    null
  );
}
