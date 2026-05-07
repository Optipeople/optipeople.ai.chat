import { fetchWithAuth } from "./authApi";

const MACHINES_URL = "/auth-api/Machine/GetMachinesForAccountLight";

export type Machine = {
  id: string;
  name: string;
};

export class MachinesForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "MachinesForbiddenError";
  }
}

// MachineLightDTO in the swagger carries many fields (deviceId, target,
// isRunning, …) — we only need id + name for the picker, so we parse
// defensively and ignore the rest.
type RawMachine = {
  id?: string;
  machineId?: string;
  name?: string;
  machineName?: string;
};

type ApiError = { title?: string; message?: string };
type ApiEnvelope = {
  data?: RawMachine[] | null;
  errors?: ApiError[] | null;
};
type MachinesResponse = ApiEnvelope | RawMachine[];

export async function getMachinesForAccount(
  accountId: string,
): Promise<Machine[]> {
  const url = `${MACHINES_URL}?accountId=${encodeURIComponent(accountId)}`;
  const res = await fetchWithAuth(url);

  // Same convention as accounts: operator-role users may see a 401/403 here;
  // treat that as "no picker needed, go straight to chat".
  if (res.status === 401 || res.status === 403) {
    throw new MachinesForbiddenError();
  }

  if (!res.ok) {
    throw new Error(`Kunne ikke hente maskiner (${res.status})`);
  }

  const body = (await res.json()) as MachinesResponse;

  if (!Array.isArray(body) && body.errors && body.errors.length > 0) {
    throw new Error(body.errors[0].message ?? "Kunne ikke hente maskiner");
  }

  const raw = Array.isArray(body) ? body : (body.data ?? []);

  return raw
    .map((r) => ({
      id: r.id ?? r.machineId ?? "",
      name: r.name ?? r.machineName ?? "",
    }))
    .filter((m) => m.id && m.name);
}
