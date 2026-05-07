const KEYS = {
  token: "token",
  refreshToken: "refresh_token",
  email: "email",
  expiresIn: "expires_in",
  accountId: "account_id",
  accountName: "account_name",
  machineId: "machine_id",
  machineName: "machine_name",
} as const;

export type StoredAccount = { id: string; name: string };
export type StoredMachine = { id: string; name: string };

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
  clearCurrentAccount();
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
  clearCurrentMachine();
}

export function getCurrentMachine(): StoredMachine | null {
  const id = localStorage.getItem(KEYS.machineId);
  const name = localStorage.getItem(KEYS.machineName);
  if (!id || !name) return null;
  return { id, name };
}

export function saveCurrentMachine(machine: StoredMachine): void {
  localStorage.setItem(KEYS.machineId, machine.id);
  localStorage.setItem(KEYS.machineName, machine.name);
}

export function clearCurrentMachine(): void {
  localStorage.removeItem(KEYS.machineId);
  localStorage.removeItem(KEYS.machineName);
}
