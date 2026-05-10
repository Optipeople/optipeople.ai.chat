// Server-side auth helpers for Optipeople bearer tokens.
//
// requireSuperAdmin is the gate for every /api/admin/* route. It resolves
// the caller's role via Optipeople /api/User/GetCurrentUser and 403s if
// role.name isn't "SuperAdmin". One round trip per admin request is fine
// for an internal tool.

const TARGET =
  process.env.OPTIPEOPLE_API_TARGET ?? "https://api-staging.optipeople.dk";

const USER_ME_PATH = "/api/User/GetCurrentUser";
const SUPER_ADMIN_ROLE = "superadmin";

export type SuperAdmin = {
  userId: string;
  email: string;
  roleName: string;
};

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

type CurrentUser = {
  id: string;
  email: string;
  roleName: string;
};

// Per-request cache so multiple helpers within a single handler don't
// double-fetch /api/User/GetCurrentUser. Keyed by the Request object,
// which is a fresh instance per incoming request.
const requestCache = new WeakMap<Request, Promise<CurrentUser>>();

async function fetchCurrentUser(token: string): Promise<CurrentUser> {
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

  // Optipeople wraps responses in { data, errors, meta }. data is a User
  // shape (per swagger): { id, email, role: { name, ... }, ... }.
  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data: unknown }).data
      : null;
  if (!data || typeof data !== "object") {
    throw new AuthError(401, "Could not resolve current user from token");
  }

  const obj = data as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id : null;
  const email = typeof obj.email === "string" ? obj.email : null;
  const role =
    obj.role && typeof obj.role === "object"
      ? (obj.role as Record<string, unknown>)
      : null;
  const roleName = role && typeof role.name === "string" ? role.name : null;

  if (!id || !email || !roleName) {
    throw new AuthError(401, "Current user response missing id/email/role");
  }
  return { id, email, roleName };
}

// Throws AuthError on failure. Catch + .toResponse() in the route handler.
export async function requireSuperAdmin(req: Request): Promise<SuperAdmin> {
  let pending = requestCache.get(req);
  if (!pending) {
    const token = getBearerToken(req);
    pending = fetchCurrentUser(token);
    requestCache.set(req, pending);
  }
  const user = await pending;

  if (user.roleName.toLowerCase() !== SUPER_ADMIN_ROLE) {
    throw new AuthError(403, "Not authorised");
  }
  return { userId: user.id, email: user.email, roleName: user.roleName };
}
