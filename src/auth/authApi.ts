import { getQrToken } from "./qrStorage";
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getUserName,
  saveSession,
} from "./storage";

const LOGIN_URL = "/auth-api/Authentication/login";

export type LoginResponse = {
  access_token: string;
  refresh_token?: string;
  user_name?: string;
  expires_in?: number;
};

// Thrown when no session exists or the refresh token is dead. Callers
// must treat this as "log in again", never as a retryable failure.
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

export type LoginErrorCode = "invalidCredentials" | "loginFailed" | "noToken";

// Login failures carry a code so the UI can render a localized message
// instead of whatever English string the backend produced.
export class LoginError extends Error {
  code: LoginErrorCode;
  status?: number;
  constructor(code: LoginErrorCode, status?: number) {
    super(`Login failed: ${code}${status ? ` (${status})` : ""}`);
    this.name = "LoginError";
    this.code = code;
    this.status = status;
  }
}

async function postLogin(body: Record<string, string>): Promise<Response> {
  return fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function login(
  email: string,
  password: string,
  remember = true,
): Promise<LoginResponse> {
  clearSession();

  const res = await postLogin({
    grant_type: "password",
    username: email,
    password,
  });

  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      throw new LoginError("invalidCredentials", res.status);
    }
    throw new LoginError("loginFailed", res.status);
  }

  const data = (await res.json()) as LoginResponse;
  if (!data.access_token) {
    throw new LoginError("noToken");
  }

  saveSession(
    { ...data, user_name: data.user_name ?? email },
    { persist: remember },
  );
  return data;
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  const email = getUserName();
  if (!refreshToken || !email) return null;

  const res = await postLogin({
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

function withQrHeader(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("X-QR-Token", token);
  return { ...init, headers };
}

// Authenticated fetch with one transparent refresh-and-retry on 401.
// Concurrent callers share a single in-flight refresh, so a token that's
// expired at app-load doesn't trigger N parallel refreshes.
//
// In QR-session mode (sessionStorage holds an Opti Assist QR token), the
// request is signed with X-QR-Token instead of an Optipeople bearer.
// Server-side, the operator endpoints accept either path. This way
// chat / feedback / source-link calls work uniformly across both
// session models without every caller knowing which mode they're in.
//
// Only throws "Session expired" when the refresh itself fails (i.e. the
// refresh token is also dead). A 401 on the *retry* is returned to the
// caller unchanged — the caller is in a better position to decide whether
// that means "forbidden for this role" or "genuinely expired", since this
// backend uses 401 for both authentication and authorization failures.
export async function fetchWithAuth(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const qrToken = getQrToken();
  if (qrToken) {
    return fetch(url, withQrHeader(init, qrToken));
  }

  const token = getAccessToken();
  if (!token) throw new SessionExpiredError();

  const res = await fetch(url, withAuthHeader(init, token));
  if (res.status !== 401) return res;

  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  const newToken = await refreshInFlight;
  if (!newToken) throw new SessionExpiredError();

  return fetch(url, withAuthHeader(init, newToken));
}
