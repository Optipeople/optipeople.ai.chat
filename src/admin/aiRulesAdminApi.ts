// Client-side wrapper for the /api/admin/accounts/[accountId]/rules
// endpoints. Same shape as mcpAdminApi.ts — fetchWithAuth forwards the
// SuperAdmin bearer automatically.

import { fetchWithAuth } from "@/auth/authApi";

export type AccountAiRule = {
  id: string;
  body: string;
  position: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AiRulesResponse = {
  systemRule: string;
  rules: AccountAiRule[];
};

export async function listAiRules(accountId: string): Promise<AiRulesResponse> {
  const res = await fetchWithAuth(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/rules`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Failed to load rules (${res.status})`);
  }
  return (await res.json()) as AiRulesResponse;
}

export async function createAiRule(
  accountId: string,
  body: string,
): Promise<AccountAiRule> {
  const res = await fetchWithAuth(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/rules`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(errBody.error ?? `Failed to create rule (${res.status})`);
  }
  const json = (await res.json()) as { rule: AccountAiRule };
  return json.rule;
}

export async function updateAiRule(
  accountId: string,
  ruleId: string,
  patch: { body?: string; enabled?: boolean; position?: number },
): Promise<AccountAiRule> {
  const res = await fetchWithAuth(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/rules/${encodeURIComponent(ruleId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(errBody.error ?? `Failed to update rule (${res.status})`);
  }
  const json = (await res.json()) as { rule: AccountAiRule };
  return json.rule;
}

export async function deleteAiRule(
  accountId: string,
  ruleId: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `/api/admin/accounts/${encodeURIComponent(accountId)}/rules/${encodeURIComponent(ruleId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(errBody.error ?? `Failed to delete rule (${res.status})`);
  }
}
