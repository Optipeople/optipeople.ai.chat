// Server-side auth helpers for Optipeople bearer tokens.
//
// requireSuperAdmin is the gate for every /api/admin/* route. It resolves
// the caller via Optipeople /api/User/GetCurrentUser and 403s if their
// permissionName isn't "SuperAdministrator". One round trip per admin
// request is fine for an internal tool.

const TARGET =
  process.env.OPTIPEOPLE_API_TARGET ?? "https://api-staging.optipeople.dk";

const USER_ME_PATH = "/api/User/GetCurrentUser";
// Stable code-style identifier from Optipeople's role catalog. The
// human-readable label ("Super Administrator") may have spacing/casing
// drift across environments — permissionName won't.
const SUPER_ADMIN_PERMISSION = "SuperAdministrator";

export type CurrentUserDetails = {
  userId: string;
  email: string;
  // Display name from Optipeople. Null if the upstream payload didn't
  // include it (older tokens). Audit views fall back to email when null.
  name: string | null;
  roleName: string;
  permissionName: string;
};

export type SuperAdmin = CurrentUserDetails;

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
  name: string | null;
  roleName: string;
  permissionName: string;
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

  // Optipeople wraps responses in { data, errors, meta }. The User
  // payload is flat, with role-related fields hoisted to the top level
  // (roleId / roleName / permissionName) rather than nested under role.
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
  const name = typeof obj.name === "string" ? obj.name : null;
  const roleName = typeof obj.roleName === "string" ? obj.roleName : null;
  const permissionName =
    typeof obj.permissionName === "string" ? obj.permissionName : null;

  if (!id || !email || !roleName || !permissionName) {
    throw new AuthError(
      401,
      "Current user response missing id/email/roleName/permissionName",
    );
  }
  return { id, email, name, roleName, permissionName };
}

// Resolves the current user from the request's bearer token. Throws
// AuthError on missing/invalid token or upstream failure. Used by every
// admin route + the chat route for audit attribution.
export async function resolveCurrentUser(
  req: Request,
): Promise<CurrentUserDetails> {
  let pending = requestCache.get(req);
  if (!pending) {
    const token = getBearerToken(req);
    pending = fetchCurrentUser(token);
    requestCache.set(req, pending);
  }
  const user = await pending;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    roleName: user.roleName,
    permissionName: user.permissionName,
  };
}

// Throws AuthError on failure. Catch + .toResponse() in the route handler.
export async function requireSuperAdmin(req: Request): Promise<SuperAdmin> {
  const user = await resolveCurrentUser(req);
  if (user.permissionName !== SUPER_ADMIN_PERMISSION) {
    throw new AuthError(403, "Not authorised");
  }
  return user;
}
