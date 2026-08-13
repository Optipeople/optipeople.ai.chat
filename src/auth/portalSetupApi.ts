// Optipeople portal calls used by the "New account" wizard. These are
// the first WRITES this app sends to the portal — everything else in
// src/auth/ is read-only. They go through the same /auth-api proxy with
// the admin's own bearer, so the portal enforces who may create what.
//
// The portal wraps responses in { data, errors, meta } with the inner
// type unpinned in the swagger, so every parser here is defensive and
// surfaces the portal's own error message when one is present.

import { fetchWithAuth } from "./authApi";

type ApiError = { title?: string; message?: string };
type Envelope<T> = { data?: T | null; errors?: ApiError[] | null };

async function request<T>(
  path: string,
  init: RequestInit,
  fallbackError: string,
): Promise<T | null> {
  const res = await fetchWithAuth(`/auth-api/${path}`, init);

  let body: Envelope<T> | T | null = null;
  try {
    body = (await res.json()) as Envelope<T> | T;
  } catch {
    // Some write endpoints return an empty body on success.
  }

  const envelope =
    body && typeof body === "object" && ("data" in body || "errors" in body)
      ? (body as Envelope<T>)
      : null;

  const portalError = envelope?.errors?.find((e) => e.message || e.title);
  if (!res.ok || portalError) {
    throw new Error(
      portalError?.message ??
        portalError?.title ??
        `${fallbackError} (${res.status})`,
    );
  }

  return envelope ? (envelope.data ?? null) : ((body as T) ?? null);
}

function get<T>(path: string, fallbackError: string): Promise<T | null> {
  return request<T>(path, { method: "GET" }, fallbackError);
}

function post<T>(
  path: string,
  payload: unknown,
  fallbackError: string,
): Promise<T | null> {
  return request<T>(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fallbackError,
  );
}

// ---------------------------------------------------------------------------
// Lookups feeding the wizard's dropdowns.

export type PortalOption = { id: string; name: string };

type RawNamed = {
  id?: string | number;
  name?: string;
  // Role rows use roleId/roleName; subscription rows have been seen with
  // type/description-style labels. Cover the aliases we know about.
  roleId?: string | number;
  roleName?: string;
  type?: string;
  description?: string;
};

function toOption(r: RawNamed): PortalOption | null {
  const id = r.id ?? r.roleId;
  const name = r.name ?? r.roleName ?? r.type ?? r.description;
  if (id === undefined || id === null || !name) return null;
  return { id: String(id), name };
}

function toOptions(rows: RawNamed[] | null): PortalOption[] {
  return (rows ?? [])
    .map(toOption)
    .filter((o): o is PortalOption => o !== null);
}

export async function getSubscriptionTypes(): Promise<PortalOption[]> {
  const rows = await get<RawNamed[]>(
    "AccountSubscriptionType/GetAll",
    "Failed to fetch subscription types",
  );
  return toOptions(rows);
}

export async function getRoles(): Promise<PortalOption[]> {
  const rows = await get<RawNamed[]>("Role/GetAll", "Failed to fetch roles");
  return toOptions(rows);
}

// Country rows are kept raw alongside the option: per the swagger's
// Country schema they can embed their timezones (countryTimeZones[]),
// which saves the TimeZone/GetByCountry round-trip when present.
export type PortalCountry = {
  option: PortalOption;
  raw: Record<string, unknown>;
};

export async function getCountries(): Promise<PortalCountry[]> {
  const rows = await get<Record<string, unknown>[]>(
    "Country/GetAllCountry",
    "Failed to fetch countries",
  );
  return (rows ?? [])
    .map((raw) => {
      const option = toOption(raw as RawNamed);
      return option ? { option, raw } : null;
    })
    .filter((c): c is PortalCountry => c !== null);
}

// The swagger's TimeZone schema labels rows with `title` + `value`
// (e.g. "(UTC+01:00) …" / IANA id) — not `name`. Keep the old aliases
// as fallbacks for shapes the portal may serve elsewhere.
type RawTimeZone = {
  id?: string | number;
  title?: string;
  displayName?: string;
  name?: string;
  value?: string;
};

function toTimeZoneOption(r: RawTimeZone | null | undefined): PortalOption | null {
  if (!r) return null;
  const name = r.title ?? r.displayName ?? r.name ?? r.value;
  if (r.id === undefined || r.id === null || !name) return null;
  return { id: String(r.id), name };
}

function embeddedTimeZones(country: PortalCountry): PortalOption[] {
  const rows = country.raw.countryTimeZones;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) =>
      toTimeZoneOption((row as { timeZone?: RawTimeZone | null }).timeZone),
    )
    .filter((o): o is PortalOption => o !== null);
}

export async function getTimeZones(
  country: PortalCountry,
): Promise<PortalOption[]> {
  // Prefer the timezones embedded on the country row itself.
  const embedded = embeddedTimeZones(country);
  if (embedded.length > 0) return embedded;

  // TimeZone/GetByCountry's query param is named `country` — not
  // countryId, which the portal silently ignores (yielding an empty
  // list). The swagger doesn't pin whether it wants the country's id or
  // its name, so try the id first and fall back to the name.
  for (const value of [country.option.id, country.option.name]) {
    const rows = await get<RawTimeZone[]>(
      `TimeZone/GetByCountry?country=${encodeURIComponent(value)}`,
      "Failed to fetch time zones",
    );
    const options = (rows ?? [])
      .map(toTimeZoneOption)
      .filter((o): o is PortalOption => o !== null);
    if (options.length > 0) return options;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Writes.

export type RegisterAccountInput = {
  accountName: string;
  adminName: string;
  email: string;
  subscriptionTypeId: string;
};

// Mirrors the portal backoffice's admin flow: registering an account
// also creates its first admin user, who gets the portal's invite mail.
// Returns the new account's id when the portal includes it in the
// response; the caller falls back to re-fetching Account/GetAll.
//
// NOTE: Account/RegisterNewAccount looks like the obvious endpoint but
// is the portal's PUBLIC self-signup route, gated by Cloudflare
// Turnstile (CF-Turnstile-Token header) — calling it with only a bearer
// yields 401. Authenticated admin creation goes through
// Account/RegisterAccount, same payload shape.
export async function registerAccount(
  input: RegisterAccountInput,
): Promise<string | null> {
  const data = await post<{ id?: string; accountId?: string }>(
    "Account/RegisterAccount",
    {
      accountName: input.accountName,
      adminName: input.adminName,
      email: input.email,
      subscriptionTypeId: input.subscriptionTypeId,
      useDefaultSystemEmail: true,
    },
    "Failed to create account",
  );
  const id = data?.id ?? data?.accountId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export type CreateFactoryInput = {
  accountId: string;
  name: string;
  timeZone: PortalOption;
  country: PortalOption;
};

// Factory/Create binds FactoryUpdateViewModel, whose timezone/country
// are the slim {id, name} models (TimeZoneModel/CountryModel) — not the
// raw lookup rows, which label timezones `title` instead of `name`.
export async function createFactory(input: CreateFactoryInput): Promise<void> {
  await post(
    `Factory/Create?accountId=${encodeURIComponent(input.accountId)}`,
    {
      name: input.name,
      accountId: input.accountId,
      timeZoneId: input.timeZone.id,
      timezone: { id: input.timeZone.id, name: input.timeZone.name },
      country: { id: input.country.id, name: input.country.name },
    },
    "Failed to create factory",
  );
}

export type CreateUserInput = {
  accountId: string;
  name: string;
  email: string;
  roleId: string;
};

// The portal sends the invite mail itself — no password handling here.
export async function createPortalUser(input: CreateUserInput): Promise<void> {
  await post(
    "User/Create",
    {
      name: input.name,
      email: input.email,
      userName: input.email,
      roleId: input.roleId,
      accountId: input.accountId,
      associatedAccountIds: [input.accountId],
    },
    "Failed to create user",
  );
}
