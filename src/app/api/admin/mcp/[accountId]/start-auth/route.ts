// POST /api/admin/mcp/:accountId/start-auth
//
// Kicks off the OAuth authorization-code flow for an account that has
// credentials saved. Returns the URL the browser should redirect to.
//
// Steps:
//   1. Look up the account's MCP config (must have client_id + secret).
//   2. Discover the auth server's authorize/token endpoints from the
//      MCP server's RFC 9728 metadata.
//   3. Generate a PKCE verifier + state and persist them on the row
//      (overwriting any prior pending flow — only one in-flight per
//      account).
//   4. Build the authorize URL with the discovered endpoint, the
//      account's client_id, our redirect_uri, and the requested scope
//      (defaulting to "mcp:tools" when the resource advertises it).
//   5. Return { authorizeUrl } to the admin UI.

import { assertAccountAccess, AuthError, requireAdmin } from "@/lib/auth";
import {
  getMcpConfig,
  getRedirectUri,
  recordError,
  storePendingAuth,
} from "@/lib/mcpConfig";
import {
  buildAuthorizeUrl,
  discoverOAuthMetadata,
  generatePkcePair,
  generateState,
  OAuthDiscoveryError,
} from "@/lib/mcpOauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFERRED_SCOPE = "mcp:tools";

async function gate(
  req: Request,
  accountId: string,
): Promise<Response | null> {
  try {
    const admin = await requireAdmin(req);
    assertAccountAccess(admin, accountId);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;
  const denied = await gate(req, accountId);
  if (denied) return denied;
  if (!accountId) {
    return Response.json({ error: "accountId is required" }, { status: 400 });
  }

  const config = await getMcpConfig(accountId);
  if (!config) {
    return Response.json(
      { error: "No MCP config found for this account" },
      { status: 404 },
    );
  }

  let meta;
  try {
    meta = await discoverOAuthMetadata(config.server_url);
  } catch (err) {
    const message =
      err instanceof OAuthDiscoveryError
        ? err.message
        : err instanceof Error
          ? err.message
          : "OAuth discovery failed";
    await recordError({ accountId, message });
    return Response.json({ error: message }, { status: 502 });
  }

  // PKCE S256 is mandatory per the Optipeople auth server's
  // code_challenge_methods_supported. If a future server omits S256
  // from the list we can fall back to "plain" but we never want to.
  if (
    meta.code_challenge_methods_supported &&
    !meta.code_challenge_methods_supported.includes("S256")
  ) {
    return Response.json(
      {
        error:
          "Authorization server does not advertise S256 PKCE; this client only supports S256.",
      },
      { status: 502 },
    );
  }

  const { verifier, challenge } = generatePkcePair();
  const state = generateState();
  await storePendingAuth({ accountId, state, verifier });

  // Pick the scope to request. Prefer the resource's advertised
  // `mcp:tools` (RFC 9728 scopes_supported), and fall back to whatever
  // the auth server lists.
  let scope: string | undefined;
  if (meta.resource_scopes?.includes(PREFERRED_SCOPE)) {
    scope = PREFERRED_SCOPE;
  } else if (meta.scopes_supported?.includes(PREFERRED_SCOPE)) {
    scope = PREFERRED_SCOPE;
  } else if (meta.scopes_supported && meta.scopes_supported.length > 0) {
    scope = meta.scopes_supported.join(" ");
  }

  const authorizeUrl = buildAuthorizeUrl({
    authorizationEndpoint: meta.authorization_endpoint,
    clientId: config.client_id,
    redirectUri: getRedirectUri(req),
    state,
    codeChallenge: challenge,
    scope,
  });

  return Response.json({ authorizeUrl });
}
