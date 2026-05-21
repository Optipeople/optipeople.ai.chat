// GET /api/mcp/oauth/callback?code=...&state=...
//
// Final leg of the OAuth authorization-code flow. The Optipeople auth
// server redirects the admin here after they approve the consent screen.
// We:
//   1. Match `state` to a pending row in account_mcp_config (PKCE
//      verifier is on that row).
//   2. Exchange `code` + the PKCE verifier for tokens.
//   3. Persist the access_token + refresh_token; redirect the admin
//      back to /admin/mcp with a status query param so the UI can show
//      a success/failure banner.
//
// Auth: this route is intentionally NOT SuperAdmin-gated. The state
// token IS the authentication — only a browser that started the flow
// (from /admin/mcp, which IS gated) holds it. Stale rows (>10 min)
// are rejected by findPendingAuthByState.

import {
  findPendingAuthByState,
  getRedirectUri,
  recordError,
  storeTokens,
} from "@/lib/mcpConfig";
import {
  discoverOAuthMetadata,
  exchangeCodeForTokens,
  OAuthTokenError,
} from "@/lib/mcpOauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminRedirect(
  req: Request,
  status: string,
  accountId: string | null,
  message?: string,
): Response {
  // Bounce the admin back to the account hub with the MCP section
  // open when we know which account this flow was for. We only fall
  // through to the picker when state was missing or unresolved — in
  // that case there's no account context to land on.
  const url = accountId
    ? new URL(
        `/admin/accounts/${encodeURIComponent(accountId)}`,
        req.url,
      )
    : new URL("/admin/accounts", req.url);
  if (accountId) url.searchParams.set("section", "mcp");
  url.searchParams.set("status", status);
  if (message) url.searchParams.set("message", message.slice(0, 200));
  return Response.redirect(url.toString(), 303);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorCode = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Authorization server reported an error rather than issuing a code.
  // We don't know which account this was for (state may or may not be
  // present); surface to the admin via the redirect so they at least
  // see the message.
  if (errorCode) {
    const message = errorDescription
      ? `${errorCode}: ${errorDescription}`
      : errorCode;
    // Best-effort cleanup of the pending row, if state is present.
    let accountId: string | null = null;
    if (state) {
      const row = await findPendingAuthByState(state).catch(() => null);
      if (row) {
        accountId = row.account_id;
        await recordError({ accountId: row.account_id, message }).catch(() => {});
      }
    }
    return adminRedirect(req, "error", accountId, message);
  }

  if (!code || !state) {
    return adminRedirect(req, "error", null, "Missing code or state in callback");
  }

  const row = await findPendingAuthByState(state).catch(() => null);
  if (!row || !row.pending_verifier) {
    return adminRedirect(
      req,
      "error",
      null,
      "No matching pending authorization (state expired or unknown)",
    );
  }

  // Rediscover the token endpoint. Cached, so this is cheap.
  let meta;
  try {
    meta = await discoverOAuthMetadata(row.server_url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "discovery failed";
    await recordError({ accountId: row.account_id, message });
    return adminRedirect(req, "error", row.account_id, message);
  }

  try {
    const tokens = await exchangeCodeForTokens({
      tokenEndpoint: meta.token_endpoint,
      clientId: row.client_id,
      clientSecret: row.client_secret,
      code,
      redirectUri: getRedirectUri(req),
      codeVerifier: row.pending_verifier,
    });
    await storeTokens({
      accountId: row.account_id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresInSeconds: tokens.expires_in ?? 3600,
    });
    return adminRedirect(req, "ok", row.account_id);
  } catch (err) {
    const message =
      err instanceof OAuthTokenError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Token exchange failed";
    await recordError({ accountId: row.account_id, message });
    return adminRedirect(req, "error", row.account_id, message);
  }
}
