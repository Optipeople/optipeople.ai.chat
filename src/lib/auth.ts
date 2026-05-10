// Server-side auth helpers for Optipeople bearer tokens.
//
// requireSuperAdmin is the gate for every /api/admin/* route. It looks up
// the caller's email via Optipeople /api/User/GetCurrentUser and checks it
// against SUPER_ADMIN_EMAILS (comma-separated, case-insensitive).
//
// We resolve the email through an upstream HTTP call rather than decoding
// the JWT locally — see STATUS.md §3 "Open decisions". One round trip per
// admin request is fine for an internal tool.

const TARGET =
  process.env.OPTIPEOPLE_API_TARGET ?? "https://api-staging.optipeople.dk";

const USER_ME_PATH = "/api/User/GetCurrentUser";

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }

  toResponse(): Response {
    return Response.json({ error: this.message }, { status: this.status });
  }
}

function getBearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new AuthError(401, "Missing or malformed Authorization header");
  }
  return match[1].trim();
}

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Per-request cache so multiple helpers within a single handler don't
// double-fetch /api/User/GetCurrentUser. Keyed by the Request object,
// which is a fresh instance per incoming request.
const requestCache = new WeakMap<Request, Promise<string>>();

async function fetchCurrentUserEmail(token: string): Promise<string> {
  let upstream: Response;
  try {
    upstream = await fetch(new URL(USER_ME_PATH, TARGET), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error("requireSuperAdmin: upstream unreachable:", err);
    throw new AuthError(502, "Auth upstream unreachable");
  }

  if (upstream.status === 401 || upstream.status === 403) {
    throw new AuthError(401, "Invalid or expired session");
  }
  if (!upstream.ok) {
    throw new AuthError(502, `Auth upstream error (${upstream.status})`);
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    throw new AuthError(502, "Auth upstream returned non-JSON");
  }

  // Optipeople wraps responses in { data, errors, meta }. The User shape
  // (per swagger) carries `email` on data.
  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data: unknown }).data
      : null;
  const email =
    data && typeof data === "object" && "email" in data
      ? (data as { email: unknown }).email
      : null;

  if (typeof email !== "string" || !email) {
    throw new AuthError(401, "Could not resolve user email from token");
  }
  return email.toLowerCase();
}

// Throws AuthError on failure. Catch + .toResponse() in the route handler.
export async function requireSuperAdmin(
  req: Request,
): Promise<{ email: string }> {
  const allowlist = parseAllowlist(process.env.SUPER_ADMIN_EMAILS);
  if (allowlist.size === 0) {
    // Fail closed: no allowlist configured means nobody is admin.
    throw new AuthError(
      500,
      "SUPER_ADMIN_EMAILS not configured on the server",
    );
  }

  let pending = requestCache.get(req);
  if (!pending) {
    const token = getBearerToken(req);
    pending = fetchCurrentUserEmail(token);
    requestCache.set(req, pending);
  }
  const email = await pending;

  if (!allowlist.has(email)) {
    throw new AuthError(403, "Not authorised");
  }
  return { email };
}
