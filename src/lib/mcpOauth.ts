// OAuth 2.0 client for the Optipeople MCP server.
//
// Implements:
//   1. Authorization Server Metadata discovery (RFC 8414) so we don't
//      have to hard-code the authorize/token URLs.
//   2. Authorization code flow with PKCE (S256). The admin starts the
//      flow from /admin/mcp; we redirect them to the MCP server's
//      authorize endpoint; the server bounces back to our /api/mcp/oauth/callback
//      with `code`, which we exchange for tokens.
//   3. Refresh-token rotation when the cached access_token is close to
//      expiry (5-minute leeway).
//
// Why discovery rather than hard-coded endpoints: the user's existing
// integration story is "paste server URL + client_id + secret". The
// authorize/token URLs come from the server itself.

import crypto from "node:crypto";

// Tolerant about field names — different OAuth servers return slightly
// different shapes (RFC 8414 / OpenID Connect / etc.). Keep only what
// we need.
export type OAuthMetadata = {
  // Discovered scopes the MCP resource expects on the bearer (RFC 9728).
  // mcp.optipeople.dk advertises "mcp:tools".
  resource_scopes?: string[];
  authorization_endpoint: string;
  token_endpoint: string;
  // RFC 7591 — Dynamic Client Registration. Present on servers that
  // accept programmatic registration (the Optipeople auth server does);
  // null on servers that require manual pre-registration.
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
  scopes_supported?: string[];
};

// RFC 9728 — Protected Resource Metadata. The MCP server publishes
// this at /.well-known/oauth-protected-resource and points us at one
// or more authorization servers via `authorization_servers`.
type ProtectedResourceMetadata = {
  resource?: string;
  authorization_servers?: string[];
  bearer_methods_supported?: string[];
  scopes_supported?: string[];
};

type CachedMetadata = {
  meta: OAuthMetadata;
  fetchedAt: number;
};

// In-memory cache. Metadata changes essentially never; refresh every
// hour is plenty and survives the lifetime of a serverless function.
const metadataCache = new Map<string, CachedMetadata>();
const METADATA_TTL_MS = 60 * 60 * 1000;

export class OAuthDiscoveryError extends Error {
  constructor(
    public serverUrl: string,
    message: string,
  ) {
    super(`OAuth discovery failed for ${serverUrl}: ${message}`);
    this.name = "OAuthDiscoveryError";
  }
}

// Paths we try on a resource URL (MCP server). RFC 9728 is the modern
// pointer-style metadata; we also try the older RFC 8414 / OIDC paths
// in case the resource IS the auth server.
const RESOURCE_WELL_KNOWN_PATHS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
];

// Paths we try on the AUTHORIZATION server itself once we know its URL.
const AUTH_SERVER_WELL_KNOWN_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
];

type WellKnownResult =
  | { kind: "protected_resource"; doc: ProtectedResourceMetadata }
  | { kind: "auth_server"; doc: Partial<OAuthMetadata> };

async function fetchJson(url: URL): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function classifyWellKnown(json: unknown): WellKnownResult | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  // Authorization Server Metadata (RFC 8414 / OIDC): has authorize+token.
  if (
    typeof obj.authorization_endpoint === "string" &&
    typeof obj.token_endpoint === "string"
  ) {
    return {
      kind: "auth_server",
      doc: obj as Partial<OAuthMetadata>,
    };
  }
  // Protected Resource Metadata (RFC 9728): has authorization_servers.
  if (Array.isArray(obj.authorization_servers)) {
    return {
      kind: "protected_resource",
      doc: obj as ProtectedResourceMetadata,
    };
  }
  return null;
}

// Discovers OAuth endpoints for a resource (MCP) URL. Handles both
// flavors: the resource may itself be the auth server (returns RFC 8414
// metadata), or it may point at one or more separate auth servers
// (RFC 9728). When multiple auth servers are listed we try them in
// order and use the first one whose metadata is usable.
export async function discoverOAuthMetadata(
  serverUrl: string,
): Promise<OAuthMetadata> {
  const cached = metadataCache.get(serverUrl);
  if (cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) {
    return cached.meta;
  }

  const resourceBase = new URL(serverUrl);
  const errors: string[] = [];

  // Step 1 — read the resource's well-known docs to find out what we're
  // dealing with.
  let protectedDoc: ProtectedResourceMetadata | null = null;
  for (const path of RESOURCE_WELL_KNOWN_PATHS) {
    const url = new URL(path, resourceBase);
    const json = await fetchJson(url);
    if (!json) {
      errors.push(`${url.pathname} → no JSON response`);
      continue;
    }
    const classified = classifyWellKnown(json);
    if (!classified) {
      errors.push(`${url.pathname} → unrecognized JSON shape`);
      continue;
    }
    if (classified.kind === "auth_server") {
      // The resource server doubles as its own auth server.
      const meta = normaliseAuthServerMetadata(classified.doc);
      if (meta) {
        metadataCache.set(serverUrl, { meta, fetchedAt: Date.now() });
        return meta;
      }
      errors.push(
        `${url.pathname} → auth-server doc missing endpoints`,
      );
      continue;
    }
    // Protected resource — note it and break to step 2.
    protectedDoc = classified.doc;
    break;
  }

  if (!protectedDoc) {
    throw new OAuthDiscoveryError(
      serverUrl,
      errors.join("; ") || "no well-known endpoints responded",
    );
  }

  const authServers = protectedDoc.authorization_servers ?? [];
  if (authServers.length === 0) {
    throw new OAuthDiscoveryError(
      serverUrl,
      "protected-resource doc listed no authorization_servers",
    );
  }

  // Step 2 — for each advertised auth server, read its metadata. First
  // one to return a usable RFC 8414 doc wins.
  for (const authBase of authServers) {
    let authUrl: URL;
    try {
      authUrl = new URL(authBase);
    } catch {
      errors.push(`auth_server '${authBase}' → invalid URL`);
      continue;
    }
    for (const path of AUTH_SERVER_WELL_KNOWN_PATHS) {
      const url = new URL(path, authUrl);
      const json = await fetchJson(url);
      if (!json) {
        errors.push(`${url.toString()} → no JSON response`);
        continue;
      }
      const classified = classifyWellKnown(json);
      if (classified?.kind !== "auth_server") {
        errors.push(`${url.toString()} → not an auth-server doc`);
        continue;
      }
      const meta = normaliseAuthServerMetadata(classified.doc);
      if (!meta) {
        errors.push(`${url.toString()} → missing authorize/token endpoints`);
        continue;
      }
      // Carry the resource's scopes forward — the chat path needs to
      // request "mcp:tools" (or whatever is advertised) when minting
      // tokens.
      meta.resource_scopes = protectedDoc.scopes_supported;
      metadataCache.set(serverUrl, { meta, fetchedAt: Date.now() });
      return meta;
    }
  }

  throw new OAuthDiscoveryError(
    serverUrl,
    errors.join("; ") || "no auth-server metadata available",
  );
}

function normaliseAuthServerMetadata(
  doc: Partial<OAuthMetadata>,
): OAuthMetadata | null {
  if (
    typeof doc.authorization_endpoint !== "string" ||
    typeof doc.token_endpoint !== "string"
  ) {
    return null;
  }
  return {
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    registration_endpoint:
      typeof doc.registration_endpoint === "string"
        ? doc.registration_endpoint
        : undefined,
    code_challenge_methods_supported: doc.code_challenge_methods_supported,
    grant_types_supported: doc.grant_types_supported,
    scopes_supported: doc.scopes_supported,
  };
}

// PKCE — RFC 7636. We generate a high-entropy verifier and its S256
// challenge. The verifier is persisted with the pending auth row; the
// challenge goes to the authorize URL. On callback we send the verifier
// to /token to prove we're the same client that started the flow.
export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

// CSRF state — short, opaque, unique per flow. We persist it with the
// pending auth row and verify the callback sends the same value back.
export function generateState(): string {
  return base64url(crypto.randomBytes(16));
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function buildAuthorizeUrl(args: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const url = new URL(args.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (args.scope) url.searchParams.set("scope", args.scope);
  return url.toString();
}

// RFC 7591 Dynamic Client Registration response. Only the fields we
// persist or rely on are captured here; extra fields the server may
// return are ignored.
export type DynamicClientRegistration = {
  client_id: string;
  client_secret: string;
  // Echoed back from the request. We assert they match what we asked
  // for, otherwise the server is silently downgrading us.
  redirect_uris?: string[];
  // Returned by some servers; we don't use it but log it for visibility.
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
};

export class OAuthRegistrationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "OAuthRegistrationError";
  }
}

// Register a new OAuth client at the auth server's RFC 7591
// registration endpoint. The response contains a fresh client_id +
// client_secret that we persist per Optipeople account. The auth
// server controls which fields it actually honors (it may downgrade
// requested scopes, refuse a token_endpoint_auth_method, etc.).
export async function registerDynamicClient(args: {
  registrationEndpoint: string;
  clientName: string;
  redirectUri: string;
  scope?: string;
}): Promise<DynamicClientRegistration> {
  const body = {
    // Required-ish per RFC 7591 §2: server uses this to label the
    // client in admin UIs (the Optipeople portal's "Label" column).
    client_name: args.clientName,
    redirect_uris: [args.redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    // Match what the auth server advertised in
    // token_endpoint_auth_methods_supported. If we send something the
    // server doesn't support, it would reject the registration.
    token_endpoint_auth_method: "client_secret_post",
    ...(args.scope ? { scope: args.scope } : {}),
  };

  const res = await fetch(args.registrationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new OAuthRegistrationError(
      res.status,
      `Registration endpoint returned non-JSON: ${text.slice(0, 200)}`,
    );
  }

  if (!res.ok) {
    const errorCode =
      typeof json.error === "string" ? (json.error as string) : null;
    const description =
      typeof json.error_description === "string"
        ? (json.error_description as string)
        : null;
    throw new OAuthRegistrationError(
      res.status,
      description ?? errorCode ?? `Registration returned ${res.status}`,
    );
  }

  if (
    typeof json.client_id !== "string" ||
    typeof json.client_secret !== "string"
  ) {
    throw new OAuthRegistrationError(
      res.status,
      "Registration response missing client_id or client_secret",
    );
  }

  return {
    client_id: json.client_id,
    client_secret: json.client_secret,
    redirect_uris: Array.isArray(json.redirect_uris)
      ? (json.redirect_uris as string[])
      : undefined,
    client_id_issued_at:
      typeof json.client_id_issued_at === "number"
        ? (json.client_id_issued_at as number)
        : undefined,
    client_secret_expires_at:
      typeof json.client_secret_expires_at === "number"
        ? (json.client_secret_expires_at as number)
        : undefined,
  };
}

export type TokenResponse = {
  access_token: string;
  // Some servers omit refresh_token on subsequent refreshes. Caller
  // should preserve the prior one when this is null.
  refresh_token?: string | null;
  // Lifetime of access_token in seconds. Defaults to 3600 when absent.
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

export class OAuthTokenError extends Error {
  constructor(
    public status: number,
    public errorCode: string | null,
    message: string,
  ) {
    super(message);
    this.name = "OAuthTokenError";
  }
}

async function postToken(
  tokenEndpoint: string,
  params: Record<string, string>,
  clientSecret: string,
): Promise<TokenResponse> {
  // The Optipeople auth server (Azure App Service) advertises only
  // `client_secret_post` in token_endpoint_auth_methods_supported, so
  // we send the credentials in the form body rather than the
  // Authorization header. `client_id` is already in `params`; we
  // splice in the secret here so callers don't have to remember.
  const formBody = new URLSearchParams({
    ...params,
    client_secret: clientSecret,
  }).toString();

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formBody,
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Token endpoints SHOULD return JSON; if they didn't, surface the
    // raw body in the error so the admin can debug.
    throw new OAuthTokenError(
      res.status,
      null,
      `Token endpoint returned non-JSON: ${text.slice(0, 200)}`,
    );
  }

  if (!res.ok) {
    const errorCode =
      typeof json.error === "string" ? (json.error as string) : null;
    const description =
      typeof json.error_description === "string"
        ? (json.error_description as string)
        : null;
    throw new OAuthTokenError(
      res.status,
      errorCode,
      description ?? errorCode ?? `Token endpoint returned ${res.status}`,
    );
  }

  if (typeof json.access_token !== "string") {
    throw new OAuthTokenError(
      res.status,
      null,
      "Token response missing access_token",
    );
  }

  return {
    access_token: json.access_token,
    refresh_token:
      typeof json.refresh_token === "string"
        ? (json.refresh_token as string)
        : null,
    expires_in:
      typeof json.expires_in === "number"
        ? (json.expires_in as number)
        : undefined,
    token_type:
      typeof json.token_type === "string"
        ? (json.token_type as string)
        : undefined,
    scope: typeof json.scope === "string" ? (json.scope as string) : undefined,
  };
}

// Exchange the one-time authorization `code` (from the redirect) for
// tokens. PKCE verifier is required since we sent S256 challenge in the
// authorize step.
export async function exchangeCodeForTokens(args: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return postToken(
    args.tokenEndpoint,
    {
      grant_type: "authorization_code",
      client_id: args.clientId,
      code: args.code,
      redirect_uri: args.redirectUri,
      code_verifier: args.codeVerifier,
    },
    args.clientSecret,
  );
}

// Use the long-lived refresh_token to mint a fresh access_token. Called
// by the chat path when the cached token is within EXPIRY_LEEWAY_MS of
// expiring.
export async function refreshAccessToken(args: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  return postToken(
    args.tokenEndpoint,
    {
      grant_type: "refresh_token",
      client_id: args.clientId,
      refresh_token: args.refreshToken,
    },
    args.clientSecret,
  );
}

// Treat tokens that expire within the next 5 minutes as already
// expired. Keeps us from handing a soon-to-die token to Anthropic and
// having it 401 mid-conversation.
export const EXPIRY_LEEWAY_MS = 5 * 60 * 1000;

export function isAccessTokenFresh(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - Date.now() > EXPIRY_LEEWAY_MS;
}
