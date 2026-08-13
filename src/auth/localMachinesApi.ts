// Machines onboarded into Opti Assist that don't exist in the
// Optipeople portal yet (created by the "New account" wizard). The
// machine picker unions these with the portal list — the portal can't
// return them.

import { fetchWithAuth } from "./authApi";
import type { Machine } from "./machinesApi";

export async function getLocalMachinesForAccount(
  accountId: string,
): Promise<Machine[]> {
  const res = await fetchWithAuth(
    `/api/machines/local?accountId=${encodeURIComponent(accountId)}`,
  );
  if (!res.ok) {
    throw new Error(`Kunne ikke hente maskiner (${res.status})`);
  }
  const body = (await res.json()) as { machines?: Machine[] };
  return body.machines ?? [];
}
