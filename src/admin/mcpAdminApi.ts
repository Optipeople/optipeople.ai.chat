// Client-side wrapper for the /api/admin/mcp endpoints. Mirrors the
// pattern in src/admin/adminApi.ts — all calls go through fetchWithAuth
// so the SuperAdmin bearer is forwarded automatically.

import { fetchWithAuth } from "@/auth/authApi";

export type McpStatus =
  | "unconfigured"
  | "pending_auth"
  | "authorized"
  | "expired"
  | "error";

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

export type McpListResponse = {
  configs: McpConfigSummary[];
  redirectUri: string;
};

export async function listMcpConfigs(): Promise<McpListResponse> {
  const res = await fetchWithAuth("/api/admin/mcp");
  if (!res.ok) {
    throw new Error(`Failed to load MCP configs (${res.status})`);
  }
  return (await res.json()) as McpListResponse;
}

// Registers a fresh OAuth client at the MCP server (RFC 7591) and
// stores the returned credentials against the account. The admin no
// longer pastes client_id/secret — they get auto-issued.
export async function registerMcpConfig(args: {
  accountId: string;
  serverUrl: string;
  label: string | null;
}): Promise<McpConfigSummary> {
  const res = await fetchWithAuth("/api/admin/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Failed to register (${res.status})`);
  }
  const body = (await res.json()) as { config: McpConfigSummary };
  return body.config;
}

export async function deleteMcpConfig(accountId: string): Promise<void> {
  const res = await fetchWithAuth(
    `/api/admin/mcp/${encodeURIComponent(accountId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Failed to delete (${res.status})`);
  }
}

export async function startMcpAuth(accountId: string): Promise<string> {
  const res = await fetchWithAuth(
    `/api/admin/mcp/${encodeURIComponent(accountId)}/start-auth`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Failed to start auth (${res.status})`);
  }
  const body = (await res.json()) as { authorizeUrl: string };
  return body.authorizeUrl;
}
