import { fetchWithAuth } from "./authApi";

const ACCOUNTS_URL = "/auth-api/Account/GetAll";

export type Account = {
  id: string;
  name: string;
};

export class AccountsForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "AccountsForbiddenError";
  }
}

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
  const res = await fetchWithAuth(ACCOUNTS_URL);

  // Operator-role users can authenticate but cannot list accounts. The
  // backend uses 401 (not 403) for insufficient role here, so we treat both
  // as "forbidden" — the token has already been refreshed by fetchWithAuth
  // if it was stale, so a 401 here is a permission issue, not a session one.
  // The caller is expected to catch this and route them straight to the chat.
  if (res.status === 401 || res.status === 403) {
    throw new AccountsForbiddenError();
  }

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
