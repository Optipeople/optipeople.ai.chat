// Fetches the set of accounts and machines that have been onboarded to
// this Opti Assist instance. The login pickers intersect their Optipeople
// lists with these sets so users only see machines the app serves.

export type RegisteredSets = {
  accountIds: Set<string>;
  machineIds: Set<string>;
};

export async function getRegisteredSets(): Promise<RegisteredSets> {
  const res = await fetch("/api/registered", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Kunne ikke hente registrerede maskiner (${res.status})`);
  }
  const body = (await res.json()) as {
    accountIds?: string[];
    machineIds?: string[];
  };
  return {
    accountIds: new Set(body.accountIds ?? []),
    machineIds: new Set(body.machineIds ?? []),
  };
}
