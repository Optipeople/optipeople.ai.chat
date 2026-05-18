-- Per-account MCP configuration for the Optipeople MCP server.
--
-- Each Optipeople account that wants Opti Assist to access its portal data
-- creates a Client ID + Client Secret in the Optipeople portal (see
-- Account → MCP tab) and an admin enters them here. We then run an
-- OAuth authorization-code flow against the MCP server to obtain an
-- access_token + refresh_token, which lets the chat route call
-- mcp.optipeople.dk on behalf of the account.
--
-- Why store tokens in the DB rather than re-exchange every request:
-- access tokens typically last ~1h, refresh tokens last days/weeks, and
-- the OAuth roundtrip is too slow to do per chat message. Tokens are
-- service-role-only (RLS below).
--
-- account_id is text to match the rest of the schema (escalation_targets,
-- machine_kb, …) — Optipeople account IDs are UUIDs but we treat them
-- as opaque strings.

create table account_mcp_config (
  account_id          text primary key,
  -- Full base URL of the MCP server, e.g. "https://mcp.optipeople.dk".
  server_url          text not null,
  -- Credentials the admin pastes from the Optipeople portal.
  client_id           text not null,
  client_secret       text not null,
  -- OAuth tokens. Populated after a successful authorization-code
  -- exchange. NULL until the admin completes the auth flow.
  access_token        text,
  refresh_token       text,
  -- Absolute expiry of the access_token. NULL when not yet authorized.
  access_token_expires_at timestamptz,
  -- PKCE verifier + state, set when the admin starts the OAuth flow
  -- and cleared by the callback. Lets us correlate the redirect back
  -- to the right account_id without trusting query params.
  pending_state       text,
  pending_verifier    text,
  pending_started_at  timestamptz,
  -- Free-text label shown in admin UI ("Production tenant", "Demo").
  label               text,
  -- Last-known status from a probe call. Helps the admin UI render a
  -- traffic-light badge without re-running the OAuth flow on every page
  -- load. Values: 'unconfigured', 'pending_auth', 'authorized', 'expired', 'error'.
  status              text not null default 'unconfigured',
  status_message      text,
  status_checked_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table account_mcp_config enable row level security;

-- Index isn't strictly needed (account_id is PK and the table will have
-- a handful of rows), but the admin status page filters by status
-- frequently enough that we'll want the seek.
create index account_mcp_config_status_idx on account_mcp_config (status);
