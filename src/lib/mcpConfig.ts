// DB layer for account_mcp_config.
//
// Three responsibilities:
//   1. CRUD for the table the admin UI talks to.
//   2. Computing the OAuth redirect_uri from the incoming request, so
//      dev (http://localhost:3000) and prod automatically use the
//      correct value. The admin registers this exact URL when creating
//      a client secret in the Optipeople portal.
//   3. A small helper for the chat route to look up "is this account
//      authorized, and if so what's its access_token?" without leaking
//      the secret/refresh_token outside this module.

import {
  discoverOAuthMetadata,
  EXPIRY_LEEWAY_MS,
  isAccessTokenFresh,
  OAuthTokenError,
  refreshAccessToken,
} from "./mcpOauth";
import { getSupabaseServerClient } from "./supabase";

export const MCP_OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback";

export type McpStatus =
  | "unconfigured"
  | "pending_auth"
  | "authorized"
  | "expired"
  | "error";

// Shape returned to admin pages. Never includes client_secret or
// refresh_token — those stay server-side.
export type McpConfigSummary = {
  accountId: string;
  serverUrl: string;
  clientId: string;
  label: string | null;
  status: McpStatus;
  statusMessage: string | null;
  statusCheckedAt: string | null;
  hasAccessToken: boolean;
  accessTokenExpiresAt: string | null;
  updatedAt: string;
};

// Internal shape — includes the secrets. Only used inside this module
// and the OAuth callback route.
export type McpConfigRow = {
  account_id: string;
  server_url: string;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: string | null;
  pending_state: string | null;
  pending_verifier: string | null;
  pending_started_at: string | null;
  label: string | null;
  status: McpStatus;
  status_message: string | null;
  status_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

function toSummary(row: McpConfigRow): McpConfigSummary {
  return {
    accountId: row.account_id,
    serverUrl: row.server_url,
    clientId: row.client_id,
    label: row.label,
    status: row.status,
    statusMessage: row.status_message,
    statusCheckedAt: row.status_checked_at,
    hasAccessToken: !!row.access_token,
    accessTokenExpiresAt: row.access_token_expires_at,
    updatedAt: row.updated_at,
  };
}

export async function listMcpConfigs(): Promise<McpConfigSummary[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_mcp_config")
    .select(
      "account_id, server_url, client_id, label, status, status_message, status_checked_at, access_token, access_token_expires_at, updated_at",
    )
    .order("updated_at", { ascending: false });
  if (error) throw error;
  // We never SELECT the secrets in the list call — `data` only carries
  // the non-sensitive columns plus a boolean-coerced access_token below.
  type ListRow = Pick<
    McpConfigRow,
    | "account_id"
    | "server_url"
    | "client_id"
    | "label"
    | "status"
    | "status_message"
    | "status_checked_at"
    | "access_token"
    | "access_token_expires_at"
    | "updated_at"
  >;
  return ((data ?? []) as ListRow[]).map((r) => ({
    accountId: r.account_id,
    serverUrl: r.server_url,
    clientId: r.client_id,
    label: r.label,
    status: r.status,
    statusMessage: r.status_message,
    statusCheckedAt: r.status_checked_at,
    hasAccessToken: !!r.access_token,
    accessTokenExpiresAt: r.access_token_expires_at,
    updatedAt: r.updated_at,
  }));
}

export async function getMcpConfig(
  accountId: string,
): Promise<McpConfigRow | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_mcp_config")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as McpConfigRow | null;
}

export async function getMcpConfigSummary(
  accountId: string,
): Promise<McpConfigSummary | null> {
  const row = await getMcpConfig(accountId);
  return row ? toSummary(row) : null;
}

// Upsert the credentials. Doesn't touch token columns — those are
// owned by the OAuth flow. If the admin re-enters credentials, the
// status drops back to "unconfigured" since the new client_id may not
// match what existing tokens were issued against.
export async function upsertMcpCredentials(args: {
  accountId: string;
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  label: string | null;
}): Promise<McpConfigSummary> {
  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("account_mcp_config")
    .upsert(
      {
        account_id: args.accountId,
        server_url: args.serverUrl,
        client_id: args.clientId,
        client_secret: args.clientSecret,
        label: args.label,
        status: "unconfigured" satisfies McpStatus,
        status_message: null,
        access_token: null,
        refresh_token: null,
        access_token_expires_at: null,
        pending_state: null,
        pending_verifier: null,
        pending_started_at: null,
        updated_at: now,
      },
      { onConflict: "account_id" },
    )
    .select("*")
    .single();
  if (error || !data) throw error ?? new Error("upsert returned no row");
  return toSummary(data as McpConfigRow);
}

export async function deleteMcpConfig(accountId: string): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("account_mcp_config")
    .delete()
    .eq("account_id", accountId);
  if (error) throw error;
}

// Persist the PKCE verifier and CSRF state for an in-progress auth
// flow. Returns the state so the caller can build the authorize URL.
export async function storePendingAuth(args: {
  accountId: string;
  state: string;
  verifier: string;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("account_mcp_config")
    .update({
      pending_state: args.state,
      pending_verifier: args.verifier,
      pending_started_at: new Date().toISOString(),
      status: "pending_auth" satisfies McpStatus,
      status_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", args.accountId);
  if (error) throw error;
}

// Pending-auth rows older than this are stale and shouldn't be honored
// by the callback. 10 minutes is plenty for the admin to walk through
// the Optipeople consent screen.
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

export async function findPendingAuthByState(
  state: string,
): Promise<McpConfigRow | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_mcp_config")
    .select("*")
    .eq("pending_state", state)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? null) as McpConfigRow | null;
  if (!row || !row.pending_started_at) return null;
  if (Date.now() - new Date(row.pending_started_at).getTime() > PENDING_AUTH_TTL_MS) {
    return null;
  }
  return row;
}

// Stores freshly-minted tokens after a successful authorization_code or
// refresh_token exchange. Wipes the pending_state/verifier scratch and
// flips status to 'authorized'.
export async function storeTokens(args: {
  accountId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  const expiresAt = new Date(Date.now() + args.expiresInSeconds * 1000).toISOString();
  // Build the patch defensively — if the server didn't return a new
  // refresh_token (some auth servers omit it on refresh), keep the
  // existing one rather than nulling it.
  const patch: Record<string, unknown> = {
    access_token: args.accessToken,
    access_token_expires_at: expiresAt,
    status: "authorized" satisfies McpStatus,
    status_message: null,
    status_checked_at: new Date().toISOString(),
    pending_state: null,
    pending_verifier: null,
    pending_started_at: null,
    updated_at: new Date().toISOString(),
  };
  if (args.refreshToken) patch.refresh_token = args.refreshToken;

  const { error } = await supabase
    .from("account_mcp_config")
    .update(patch)
    .eq("account_id", args.accountId);
  if (error) throw error;
}

export async function recordError(args: {
  accountId: string;
  message: string;
  status?: McpStatus;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("account_mcp_config")
    .update({
      status: args.status ?? ("error" satisfies McpStatus),
      status_message: args.message,
      status_checked_at: new Date().toISOString(),
      pending_state: null,
      pending_verifier: null,
      pending_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", args.accountId);
  if (error) throw error;
}

// Computes the OAuth callback URL the admin must register in the
// Optipeople portal. Derives the origin from the request headers so
// dev and prod work without per-environment config. Falls back to
// PUBLIC_APP_URL if set.
export function getRedirectUri(req: Request): string {
  const explicit = process.env.PUBLIC_APP_URL;
  if (explicit) {
    return `${explicit.replace(/\/$/, "")}${MCP_OAUTH_CALLBACK_PATH}`;
  }
  const origin = req.headers.get("origin");
  if (origin) {
    return `${origin.replace(/\/$/, "")}${MCP_OAUTH_CALLBACK_PATH}`;
  }
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}${MCP_OAUTH_CALLBACK_PATH}`;
}

// Re-export the freshness helper from mcpOauth so callers don't have
// to import both modules.
export { isAccessTokenFresh, EXPIRY_LEEWAY_MS };

// Shape the chat route needs to call MCP via Anthropic's connector.
// Both fields are required; we return null instead when the account
// isn't ready (no config, never authorized, or refresh failed).
export type McpAccess = {
  serverUrl: string;
  accessToken: string;
};

// Dedupe concurrent refreshes per account. If two chat requests for
// the same account arrive at once and the access_token has expired,
// we only want one /token call. The map holds the in-flight promise
// keyed by account_id; resolves to the new token or null on failure.
const refreshInFlight = new Map<string, Promise<string | null>>();

async function performRefresh(row: McpConfigRow): Promise<string | null> {
  if (!row.refresh_token) return null;
  try {
    const meta = await discoverOAuthMetadata(row.server_url);
    const tokens = await refreshAccessToken({
      tokenEndpoint: meta.token_endpoint,
      clientId: row.client_id,
      clientSecret: row.client_secret,
      refreshToken: row.refresh_token,
    });
    await storeTokens({
      accountId: row.account_id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresInSeconds: tokens.expires_in ?? 3600,
    });
    return tokens.access_token;
  } catch (err) {
    // OAuth servers return `invalid_grant` when a refresh_token has
    // been revoked or expired. Flag the row so the admin sees they
    // need to reauthorize, rather than silently failing every chat.
    const message =
      err instanceof OAuthTokenError
        ? err.message
        : err instanceof Error
          ? err.message
          : "refresh failed";
    const status =
      err instanceof OAuthTokenError && err.errorCode === "invalid_grant"
        ? "expired"
        : "error";
    await recordError({
      accountId: row.account_id,
      message,
      status,
    }).catch((dbErr) => {
      console.error("recordError after refresh failure also failed:", dbErr);
    });
    return null;
  }
}

// Returns a usable {serverUrl, accessToken} for an account, refreshing
// if the cached token is within EXPIRY_LEEWAY_MS of expiring. Returns
// null when:
//   - the account has no MCP config
//   - the row was never authorized (no access_token / refresh_token)
//   - the refresh attempt failed (token revoked etc.)
// Callers should fall back to "no MCP" behavior in that case.
export async function getMcpAccessForAccount(
  accountId: string,
): Promise<McpAccess | null> {
  const row = await getMcpConfig(accountId);
  if (!row) return null;
  if (!row.access_token) return null;

  const expiresAt = row.access_token_expires_at
    ? new Date(row.access_token_expires_at)
    : null;
  if (isAccessTokenFresh(expiresAt)) {
    return { serverUrl: row.server_url, accessToken: row.access_token };
  }

  // Token is stale — dedupe the refresh across concurrent callers.
  let pending = refreshInFlight.get(accountId);
  if (!pending) {
    pending = performRefresh(row).finally(() => {
      refreshInFlight.delete(accountId);
    });
    refreshInFlight.set(accountId, pending);
  }
  const fresh = await pending;
  if (!fresh) return null;
  return { serverUrl: row.server_url, accessToken: fresh };
}
