# Optipeople portal data access from OptiAI

OptiAI surfaces machine data (stops, KPIs, telemetry, …) inside the
chat by connecting to the **Optipeople MCP server** with a per-account
OAuth client. Anthropic's MCP connector (`mcp_servers` on the beta
Messages API) handles tool discovery and invocation; the chat route's
only job is to mint a fresh access token for the right account before
calling the model.

## Architecture in one paragraph

Each Optipeople account that wants OptiAI to call its portal gets a
row in `account_mcp_config`. The row stores the MCP server URL, an
OAuth `client_id` + `client_secret` we got from dynamic client
registration (RFC 7591), and the long-lived `refresh_token` we got
from the admin's one-time authorization-code flow. On every chat turn
the route asks [`getMcpAccessForAccount`](../src/lib/mcpConfig.ts) for
a fresh `access_token` — refreshing if necessary — and passes
`{ name, type: "url", url, authorization_token }` to
`anthropic.beta.messages.stream` via `mcp_servers`. Anthropic talks to
`mcp.optipeople.dk` directly using that token; we never see the MCP
tool calls in our agent loop. Accounts without an authorized config
fall back to the GA `search_kb`-only path automatically.

## Why MCP rather than direct Swagger

We tried wiring the Optipeople Swagger API directly (the file
[src/lib/optipeopleApi.ts] used to live here, now removed). Two
showstoppers pushed us to MCP:

- **QR-sticker sessions had no portal access.** Direct Swagger needs
  the operator's bearer token; QR sessions don't have one. With MCP,
  the credentials are account-scoped, not user-scoped — QR sessions
  share the same token as everyone else in that account.
- **Endpoint sprawl.** Every new question type ("what's my OEE?",
  "how many parts ran last shift?", …) would have needed its own
  custom tool, its own Swagger call, its own argument plumbing. MCP
  hands us a curated tool catalog the Optipeople team maintains; new
  tools appear automatically without code changes here.

The `mcp:tools` scope (advertised in the Protected Resource Metadata
at `https://mcp.optipeople.dk/.well-known/oauth-protected-resource`)
is what we request during authorization.

## OAuth flow — exactly what happens

1. **Discovery.** [`discoverOAuthMetadata`](../src/lib/mcpOauth.ts)
   fetches the MCP server's `/.well-known/oauth-protected-resource`
   (RFC 9728), follows the `authorization_servers` pointer to the
   actual auth server (Azure App Service at
   `opti-app-service-prod-oauth.azurewebsites.net`), then fetches its
   `/.well-known/oauth-authorization-server` (RFC 8414) to learn the
   authorize/token/registration endpoints, supported grants, PKCE
   methods, and token-endpoint auth method (`client_secret_post`).
2. **Dynamic Client Registration.** When a SuperAdmin clicks **Add
   credentials** on `/admin/mcp`, the backend POSTs to the
   `registration_endpoint` with our redirect URI, requested scope
   (`mcp:tools`), grants (`authorization_code` + `refresh_token`), and
   `token_endpoint_auth_method: "client_secret_post"`. The auth server
   issues a fresh `client_id` + `client_secret` — these appear in the
   Optipeople portal under **Account → MCP → Client Secrets** with
   the label we set on `client_name`.
3. **Authorization-code + PKCE.** The admin clicks **Connect** on the
   row. Backend generates a PKCE verifier and CSRF state, persists
   them on the row, and returns the authorize URL. Browser redirects
   to the Optipeople auth server, the admin approves, and the auth
   server bounces back to `/api/mcp/oauth/callback` with `code` +
   `state`. The callback looks up the pending row by state, exchanges
   the code for tokens, and stores `access_token` + `refresh_token`.
4. **Per-chat use.** [`getMcpAccessForAccount`](../src/lib/mcpConfig.ts)
   reads the row, refreshes the access token if it's within
   5 minutes of expiry (concurrent refreshes for the same account
   are deduped via an in-process Promise map), and returns
   `{ serverUrl, accessToken }`. The chat route hands that to
   Anthropic; if it returns null, the chat continues without MCP.

## Failure modes and recovery

- **`invalid_grant` on refresh.** The refresh token was revoked or
  expired. `performRefresh` flips the row's `status` to `expired` so
  the admin sees on `/admin/mcp` they need to click **Reauthorize**.
- **Auth server returns 5xx during discovery.** Surfaced as the
  banner message on `/admin/mcp` after the callback redirect.
- **MCP server returns 401 mid-chat.** Anthropic surfaces this in
  the stream; we don't currently auto-retry. The admin would need to
  reauthorize the row.

## What's not done yet

- **MCP status badge on `/admin/machines/[id]`.** Visual hint that a
  machine's account has MCP set up — TODO from the original spec.
- **Per-user profile visibility.** Surfacing MCP-connected status to
  non-admin users in their profile view — TODO.
- **MCP tool-use event surfacing in the chat UI.** Anthropic emits
  `mcp_tool_use` / `mcp_tool_result` blocks; we currently filter the
  agent loop only on `tool_use` (our `search_kb`), so MCP calls are
  invisible to the operator and the audit log. Worth surfacing them
  as `tool_use` events on the SSE stream so the UI can show
  "Fetching machine data…" indicators.
