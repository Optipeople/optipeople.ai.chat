// GET  /api/admin/mcp           — list every configured account
// POST /api/admin/mcp           — register a fresh OAuth client at the
//                                  MCP server (RFC 7591) and store the
//                                  returned client_id + client_secret
//                                  against an Optipeople account.
//
// The admin doesn't paste client credentials anymore — we generate
// them via Dynamic Client Registration, mirroring how ChatGPT
// integrates. They only enter the account UUID, the MCP server URL,
// and an optional label.

import { getTranslations } from "next-intl/server";
import {
  assertAccountAccess,
  AuthError,
  requireAdmin,
  type Admin,
} from "@/lib/auth";
import {
  getRedirectUri,
  listMcpConfigs,
  upsertMcpCredentials,
} from "@/lib/mcpConfig";
import {
  discoverOAuthMetadata,
  OAuthDiscoveryError,
  OAuthRegistrationError,
  registerDynamicClient,
} from "@/lib/mcpOauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CLIENT_NAME = "Opti Assist";
const PREFERRED_SCOPE = "mcp:tools";

async function gate(
  req: Request,
): Promise<{ admin: Admin | null; denied: Response | null }> {
  try {
    const admin = await requireAdmin(req);
    return { admin, denied: null };
  } catch (err) {
    if (err instanceof AuthError) return { admin: null, denied: err.toResponse() };
    throw err;
  }
}

export async function GET(req: Request) {
  const { admin, denied } = await gate(req);
  if (denied) return denied;

  try {
    const configs = await listMcpConfigs();
    // Account admins only see their own account's row.
    const filtered =
      admin!.role === "account"
        ? configs.filter((c) => c.accountId === admin!.accountId)
        : configs;
    return Response.json({
      configs: filtered,
      redirectUri: getRedirectUri(req),
    });
  } catch (err) {
    console.error("admin/mcp list failed:", err);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { admin, denied } = await gate(req);
  if (denied) return denied;

  const t = await getTranslations("server");

  let body: {
    accountId?: unknown;
    serverUrl?: unknown;
    label?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const accountId =
    typeof body.accountId === "string" ? body.accountId.trim() : "";
  const serverUrl =
    typeof body.serverUrl === "string" ? body.serverUrl.trim() : "";
  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim()
      : null;

  if (!accountId || !serverUrl) {
    return Response.json(
      { error: "accountId and serverUrl are required" },
      { status: 400 },
    );
  }
  try {
    assertAccountAccess(admin!, accountId);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  try {
    const parsed = new URL(serverUrl);
    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && parsed.hostname === "localhost")
    ) {
      return Response.json(
        { error: "serverUrl must be https (or http://localhost for dev)" },
        { status: 400 },
      );
    }
  } catch {
    return Response.json({ error: "serverUrl is not a valid URL" }, { status: 400 });
  }

  // 1. Discover the auth server's metadata via the MCP resource's
  //    well-known doc.
  let meta;
  try {
    meta = await discoverOAuthMetadata(serverUrl);
  } catch (err) {
    const message =
      err instanceof OAuthDiscoveryError
        ? err.message
        : err instanceof Error
          ? err.message
          : "OAuth discovery failed";
    return Response.json({ error: message }, { status: 502 });
  }

  if (!meta.registration_endpoint) {
    return Response.json(
      {
        error:
          "Authorization server does not support dynamic client registration. Configure credentials manually via the database.",
      },
      { status: 502 },
    );
  }

  // 2. Register a fresh client. The redirect URI is whatever this
  //    request's host implies — same one the OAuth callback will use.
  //    The auth server stores it against the new client and rejects
  //    mismatched redirect_uris on the eventual /authorize call.
  const redirectUri = getRedirectUri(req);

  // Pick the scope the resource asks for. The auth server advertised
  // "mcp:tools" in scopes_supported; we request only that.
  const scope = meta.scopes_supported?.includes(PREFERRED_SCOPE)
    ? PREFERRED_SCOPE
    : undefined;

  // Compose a descriptive client_name so the row in the Optipeople
  // portal makes sense at a glance. The portal's "Label" column shows
  // this verbatim.
  const clientName = label
    ? `${DEFAULT_CLIENT_NAME} — ${label}`
    : `${DEFAULT_CLIENT_NAME} (account ${accountId.slice(0, 8)})`;

  let registration;
  try {
    registration = await registerDynamicClient({
      registrationEndpoint: meta.registration_endpoint,
      clientName,
      redirectUri,
      scope,
    });
  } catch (err) {
    const message =
      err instanceof OAuthRegistrationError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Dynamic client registration failed";
    console.error("admin/mcp DCR failed:", err);
    return Response.json({ error: message }, { status: 502 });
  }

  // 3. Persist the new credentials. Any prior tokens for this account
  //    are wiped (upsertMcpCredentials does that), so the admin has to
  //    re-authorize after re-registering.
  try {
    const summary = await upsertMcpCredentials({
      accountId,
      serverUrl,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
      label,
    });
    return Response.json(
      {
        config: summary,
        redirectUri,
        registration: {
          clientId: registration.client_id,
          redirectUris: registration.redirect_uris,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("admin/mcp upsert failed:", err);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}
