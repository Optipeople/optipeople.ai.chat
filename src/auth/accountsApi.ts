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
  isDeleted?: boolean;
  isActive?: boolean;
  active?: boolean;
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

  return mapAccounts(raw);
}

function mapAccounts(raw: RawAccount[]): Account[] {
  return raw
    .map((r) => ({
      id: r.id ?? r.accountId ?? "",
      name: r.name ?? r.accountName ?? "",
    }))
    .filter((a) => a.id && a.name);
}

// The swagger doesn't pin where a pager response keeps its rows: data
// may be the row array itself or a wrapper object. Probe the common
// pager shapes.
function extractPagedRows(data: unknown): RawAccount[] {
  if (Array.isArray(data)) return data as RawAccount[];
  if (data && typeof data === "object") {
    for (const key of ["items", "list", "results", "rows", "data", "accounts"]) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as RawAccount[];
    }
  }
  return [];
}

// The portal backoffice lists accounts through the paged Account/GetByPage
// route, and it doesn't always agree with Account/GetAll: an account a
// partner just registered can be missing from their GetAll while the
// backoffice shows it. Callers use this as a best-effort supplement —
// both to recover a fresh account's id by name and to keep the picker
// consistent with what the portal itself displays.
export async function searchAccounts(keyword: string): Promise<Account[]> {
  const params = new URLSearchParams({
    keyword,
    page: "1",
    pageSize: "200",
  });
  const res = await fetchWithAuth(`/auth-api/Account/GetByPage?${params}`);

  if (!res.ok) {
    throw new Error(`Kunne ikke hente konti (${res.status})`);
  }

  const body = (await res.json()) as AccountsResponse | { data?: unknown };

  if (
    !Array.isArray(body) &&
    "errors" in body &&
    body.errors &&
    body.errors.length > 0
  ) {
    throw new Error(body.errors[0].message ?? "Kunne ikke hente konti");
  }

  const rows = Array.isArray(body)
    ? body
    : extractPagedRows(body.data ?? null);

  // Backoffice grids can include disabled/deleted rows GetAll would
  // filter out — skip anything explicitly flagged.
  return mapAccounts(
    rows.filter(
      (r) =>
        r.isDeleted !== true && r.isActive !== false && r.active !== false,
    ),
  );
}
