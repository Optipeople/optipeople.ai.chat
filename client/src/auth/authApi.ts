import {
  clearSession,
  getAccessToken,
  getAuthScope,
  getRefreshToken,
  getUserName,
  saveAuthScope,
  saveSession,
  type AuthScope,
} from "./storage";

const PORTAL_LOGIN_URL = "/auth-api/Authentication/login";
const MOBILE_LOGIN_URL = "/auth-api/IncomacAuthentication/Login";

function loginUrlFor(scope: AuthScope): string {
  return scope === "portal" ? PORTAL_LOGIN_URL : MOBILE_LOGIN_URL;
}

export type LoginResponse = {
  access_token: string;
  refresh_token?: string;
  user_name?: string;
  expires_in?: number;
};

async function postLogin(
  url: string,
  body: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  clearSession();

  const body = { grant_type: "password", username: email, password };

  // Try the portal endpoint first (admins, account admins, account users).
  // Fall back to the mobile endpoint for operator-role users, who only exist
  // on the Incomac side.
  let scope: AuthScope = "portal";
  let res = await postLogin(PORTAL_LOGIN_URL, body);
  if (res.status === 400 || res.status === 401) {
    res = await postLogin(MOBILE_LOGIN_URL, body);
    scope = "mobile";
  }

  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new Error("Invalid email or password");
    }
    throw new Error(`Login failed (${res.status})`);
  }

  const data = (await res.json()) as LoginResponse;
  if (!data.access_token) {
    throw new Error("Authentication failed: no access token received");
  }

  saveSession({ ...data, user_name: data.user_name ?? email });
  saveAuthScope(scope);
  return data;
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  const email = getUserName();
  const scope = getAuthScope();
  if (!refreshToken || !email || !scope) return null;

  const res = await postLogin(loginUrlFor(scope), {
    grant_type: "refresh_token",
    username: email,
    refresh_token: refreshToken,
  });
  if (!res.ok) return null;

  const data = (await res.json()) as LoginResponse;
  if (!data.access_token) return null;

  saveSession({ ...data, user_name: data.user_name ?? email });
  return data.access_token;
}

function withAuthHeader(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

// Authenticated fetch with one transparent refresh-and-retry on 401.
// Concurrent callers share a single in-flight refresh, so a token that's
// expired at app-load doesn't trigger N parallel refreshes.
export async function fetchWithAuth(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getAccessToken();
  if (!token) throw new Error("Session expired");

  let res = await fetch(url, withAuthHeader(init, token));
  if (res.status !== 401) return res;

  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  const newToken = await refreshInFlight;
  if (!newToken) throw new Error("Session expired");

  res = await fetch(url, withAuthHeader(init, newToken));
  if (res.status === 401) throw new Error("Session expired");
  return res;
}
