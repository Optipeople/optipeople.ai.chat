import { fetchWithAuth } from "./authApi";

const URL = "/auth-api/Account/GetAccountsWithFactoryAndMachines";

export type FactoryLite = {
  id: string;
  name: string;
  accountId: string;
};

// Map of machineId -> { factoryId, factoryName }. The Optipeople platform
// stores factory membership on the machine row; the admin/machines endpoint
// doesn't expose it yet, so we join client-side from this hierarchy call.
export type MachineFactoryMap = Map<
  string,
  { factoryId: string; factoryName: string }
>;

type RawMachine = { id?: string; name?: string };
type RawFactory = {
  id?: string;
  name?: string;
  machines?: RawMachine[] | null;
};
type RawAccount = {
  id?: string;
  accountId?: string;
  factories?: RawFactory[] | null;
};
type Envelope = { data?: RawAccount[] | null };

export type AccountsHierarchy = {
  factories: FactoryLite[];
  machineToFactory: MachineFactoryMap;
};

export async function getAccountsHierarchy(): Promise<AccountsHierarchy> {
  const res = await fetchWithAuth(URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch factories (${res.status})`);
  }
  const body = (await res.json()) as Envelope | RawAccount[];
  const accounts = Array.isArray(body) ? body : (body.data ?? []);

  const factories: FactoryLite[] = [];
  const machineToFactory: MachineFactoryMap = new Map();

  for (const a of accounts) {
    const accountId = a.id ?? a.accountId ?? "";
    if (!accountId) continue;
    for (const f of a.factories ?? []) {
      const factoryId = f.id ?? "";
      const factoryName = f.name ?? "";
      if (!factoryId || !factoryName) continue;
      factories.push({ id: factoryId, name: factoryName, accountId });
      for (const m of f.machines ?? []) {
        if (m.id) {
          machineToFactory.set(m.id, { factoryId, factoryName });
        }
      }
    }
  }

  return { factories, machineToFactory };
}
