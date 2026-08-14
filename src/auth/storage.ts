const KEYS = {
  token: "token",
  refreshToken: "refresh_token",
  email: "email",
  expiresIn: "expires_in",
  accountId: "account_id",
  accountName: "account_name",
  machineId: "machine_id",
  machineName: "machine_name",
  // "1" when the user picked "All machines" (fleet scope) instead of a
  // single machine. Mutually exclusive with machineId — AuthContext
  // clears one when setting the other.
  fleetMode: "fleet_mode",
} as const;

export type StoredAccount = { id: string; name: string };
export type StoredMachine = { id: string; name: string };

// The session lives in exactly one store: localStorage when the user
// checked "remember me" (survives browser restarts), sessionStorage
// otherwise (dies with the tab). Refresh-token rotation re-saves into
// whichever store currently holds the session.
function tokenStore(): Storage {
  return sessionStorage.getItem(KEYS.token) ? sessionStorage : localStorage;
}

function getSessionItem(key: string): string | null {
  return sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

export function getAccessToken(): string | null {
  return getSessionItem(KEYS.token);
}

export function getRefreshToken(): string | null {
  return getSessionItem(KEYS.refreshToken);
}

export function getUserName(): string | null {
  return getSessionItem(KEYS.email);
}

export type SessionPayload = {
  access_token: string;
  refresh_token?: string;
  user_name?: string;
  expires_in?: number;
};

export function saveSession(
  payload: SessionPayload,
  opts?: { persist?: boolean },
): void {
  let store = tokenStore();
  if (opts && typeof opts.persist === "boolean") {
    store = opts.persist ? localStorage : sessionStorage;
    clearSessionTokens();
  }
  store.setItem(KEYS.token, payload.access_token);
  if (payload.refresh_token) {
    store.setItem(KEYS.refreshToken, payload.refresh_token);
  }
  if (payload.user_name) {
    store.setItem(KEYS.email, payload.user_name);
  }
  if (typeof payload.expires_in === "number") {
    store.setItem(KEYS.expiresIn, String(payload.expires_in));
  }
}

function clearSessionTokens(): void {
  for (const store of [localStorage, sessionStorage]) {
    store.removeItem(KEYS.token);
    store.removeItem(KEYS.refreshToken);
    store.removeItem(KEYS.email);
    store.removeItem(KEYS.expiresIn);
  }
}

export function clearSession(): void {
  clearSessionTokens();
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
  clearFleetSelected();
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

export function getFleetSelected(): boolean {
  return localStorage.getItem(KEYS.fleetMode) === "1";
}

export function saveFleetSelected(): void {
  localStorage.setItem(KEYS.fleetMode, "1");
}

export function clearFleetSelected(): void {
  localStorage.removeItem(KEYS.fleetMode);
}
