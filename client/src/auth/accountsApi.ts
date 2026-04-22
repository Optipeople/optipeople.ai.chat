import { fetchWithAuth } from "./authApi";
import { getAuthScope } from "./storage";

const PORTAL_ACCOUNTS_URL = "/auth-api/Account/GetAll";
const MOBILE_ACCOUNTS_URL = "/auth-api/IncomacApp/GetAccounts";

export type Account = {
  id: string;
  name: string;
};

// Field naming varies across the spec's account view models (id vs accountId,
// name vs accountName), and the inner data type isn't pinned in the response
// envelope. Parse defensively.
type RawAccount = {
  id?: string;
  accountId?: string;
  name?: string;
  accountName?: string;
};

type ApiError = { title?: string; message?: string };
type ApiEnvelope = {
  data?: RawAccount[] | null;
  errors?: ApiError[] | null;
};
type AccountsResponse = ApiEnvelope | RawAccount[];

export async function getAccounts(): Promise<Account[]> {
  const scope = getAuthScope();
  const url =
    scope === "mobile" ? MOBILE_ACCOUNTS_URL : PORTAL_ACCOUNTS_URL;

  const res = await fetchWithAuth(url);

  if (!res.ok) {
    throw new Error(`Kunne ikke hente konti (${res.status})`);
  }

  const body = (await res.json()) as AccountsResponse;

  if (!Array.isArray(body) && body.errors && body.errors.length > 0) {
    throw new Error(body.errors[0].message ?? "Kunne ikke hente konti");
  }

  const raw = Array.isArray(body) ? body : (body.data ?? []);

  return raw
    .map((r) => ({
      id: r.id ?? r.accountId ?? "",
      name: r.name ?? r.accountName ?? "",
    }))
    .filter((a) => a.id && a.name);
}
