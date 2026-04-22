const KEYS = {
  token: "token",
  refreshToken: "refresh_token",
  email: "email",
  expiresIn: "expires_in",
  accountId: "account_id",
  accountName: "account_name",
  authScope: "auth_scope",
} as const;

export type StoredAccount = { id: string; name: string };
export type AuthScope = "portal" | "mobile";

export function getAccessToken(): string | null {
  return localStorage.getItem(KEYS.token);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(KEYS.refreshToken);
}

export function getUserName(): string | null {
  return localStorage.getItem(KEYS.email);
}

export type SessionPayload = {
  access_token: string;
  refresh_token?: string;
  user_name?: string;
  expires_in?: number;
};

export function saveSession(payload: SessionPayload): void {
  localStorage.setItem(KEYS.token, payload.access_token);
  if (payload.refresh_token) {
    localStorage.setItem(KEYS.refreshToken, payload.refresh_token);
  }
  if (payload.user_name) {
    localStorage.setItem(KEYS.email, payload.user_name);
  }
  if (typeof payload.expires_in === "number") {
    localStorage.setItem(KEYS.expiresIn, String(payload.expires_in));
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEYS.token);
  localStorage.removeItem(KEYS.refreshToken);
  localStorage.removeItem(KEYS.email);
  localStorage.removeItem(KEYS.expiresIn);
  localStorage.removeItem(KEYS.authScope);
  clearCurrentAccount();
}

export function getAuthScope(): AuthScope | null {
  const v = localStorage.getItem(KEYS.authScope);
  return v === "portal" || v === "mobile" ? v : null;
}

export function saveAuthScope(scope: AuthScope): void {
  localStorage.setItem(KEYS.authScope, scope);
}

export function getCurrentAccount(): StoredAccount | null {
  const id = localStorage.getItem(KEYS.accountId);
  const name = localStorage.getItem(KEYS.accountName);
  if (!id || !name) return null;
  return { id, name };
}

export function saveCurrentAccount(account: StoredAccount): void {
  localStorage.setItem(KEYS.accountId, account.id);
  localStorage.setItem(KEYS.accountName, account.name);
}

export function clearCurrentAccount(): void {
  localStorage.removeItem(KEYS.accountId);
  localStorage.removeItem(KEYS.accountName);
}
