import { fetchWithAuth } from "@/auth/authApi";
import type { AdminMachine } from "@/app/api/admin/machines/route";

export type { AdminMachine };

export async function getAdminMachines(): Promise<AdminMachine[]> {
  const res = await fetchWithAuth("/api/admin/machines");
  if (res.status === 401 || res.status === 403) {
    throw new Error("Du har ikke adgang til admin");
  }
  if (!res.ok) {
    throw new Error(`Kunne ikke hente maskiner (${res.status})`);
  }
  const body = (await res.json()) as { machines?: AdminMachine[] };
  return body.machines ?? [];
}
