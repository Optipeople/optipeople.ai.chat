// Server-side auth helpers for Optipeople bearer tokens.
//
// requireSuperAdmin / requireAdmin gate every /api/admin/* route. They
// resolve the caller via Optipeople /api/User/GetCurrentUser and 403 if
// their permissionName isn't in the allowed set. One round trip per
// admin request is fine for an internal tool.
//
// requireAdmin allows SuperAdministrator and Partner (both
// cross-account) plus AccountAdministrator (their own account only).
// Account admins must have their access scoped per-resource — use
// assertAccountAccess, assertMachineAccess, assertDocumentAccess or
// assertConversationAccess from the route handler.

import { getSupabaseServerClient } from "./supabase";

const TARGET =
  process.env.OPTIPEOPLE_API_TARGET ?? "https://api-staging.optipeople.dk";

const USER_ME_PATH = "/api/User/GetCurrentUser";
// Stable code-style identifiers from Optipeople's role catalog. The
// human-readable label ("Super Administrator") may have spacing/casing
// drift across environments — permissionName won't.
const SUPER_ADMIN_PERMISSION = "SuperAdministrator";
const ACCOUNT_ADMIN_PERMISSION = "AccountAdministrator";
// Optipeople partners get exactly the same rights as super admins here:
// cross-account, no per-resource scoping. Keep this in sync with
// FULL_ACCESS_PERMISSIONS in src/auth/AuthContext.tsx.
const PARTNER_PERMISSION = "Partner";

// Permissions that grant unscoped, cross-account access.
const FULL_ACCESS_PERMISSIONS: readonly string[] = [
  SUPER_ADMIN_PERMISSION,
  PARTNER_PERMISSION,
];

// Exported for routes that serve non-admin users too and only need the
// "may this caller see any account?" half of the check (e.g. the local
// machine listing used by the machine picker).
export function hasFullAccess(permissionName: string): boolean {
  return FULL_ACCESS_PERMISSIONS.includes(permissionName);
}

export type AdminRole = "super" | "account";

export type CurrentUserDetails = {
  userId: string;
  email: string;
  // Display name from Optipeople. Null if the upstream payload didn't
  // include it (older tokens). Audit views fall back to email when null.
  name: string | null;
  roleName: string;
  permissionName: string;
  // Optipeople account the user belongs to. Required for account admins
  // (we 403 them at requireAdmin if it's missing); super admins can have
  // null here since their scope is cross-account.
  accountId: string | null;
};

export type SuperAdmin = CurrentUserDetails;

// What requireAdmin returns. Discriminated by `role` so route handlers
// can write `if (admin.role === "account") …` without re-checking
// permissionName strings.
export type Admin =
  | (CurrentUserDetails & { role: "super" })
  | (CurrentUserDetails & { role: "account"; accountId: string });

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
  accountId: string | null;
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
    console.error("requireAdmin: upstream unreachable:", err);
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
  const accountId =
    typeof obj.accountId === "string" && obj.accountId.length > 0
      ? obj.accountId
      : null;

  if (!id || !email || !roleName || !permissionName) {
    throw new AuthError(
      401,
      "Current user response missing id/email/roleName/permissionName",
    );
  }
  return { id, email, name, roleName, permissionName, accountId };
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
    accountId: user.accountId,
  };
}

// Throws AuthError on failure. Catch + .toResponse() in the route
// handler. Partners pass this gate too — they hold the same rights as
// super admins.
export async function requireSuperAdmin(req: Request): Promise<SuperAdmin> {
  const user = await resolveCurrentUser(req);
  if (!hasFullAccess(user.permissionName)) {
    throw new AuthError(403, "Not authorised");
  }
  return user;
}

// Allows SuperAdministrator / Partner (full access) or
// AccountAdministrator (account-scoped — see assertAccountAccess and
// friends). Throws AuthError on failure. Account admins without an
// accountId on their Optipeople user are rejected — without the scope
// we can't enforce anything.
export async function requireAdmin(req: Request): Promise<Admin> {
  const user = await resolveCurrentUser(req);
  if (hasFullAccess(user.permissionName)) {
    return { ...user, role: "super" };
  }
  if (user.permissionName === ACCOUNT_ADMIN_PERMISSION) {
    if (!user.accountId) {
      throw new AuthError(
        403,
        "Account administrator has no accountId on their Optipeople user",
      );
    }
    return { ...user, role: "account", accountId: user.accountId };
  }
  throw new AuthError(403, "Not authorised");
}

// No-op for super admins. For account admins, 403s if `accountId`
// doesn't match the admin's own account. Use after requireAdmin in
// routes that take an accountId parameter.
export function assertAccountAccess(admin: Admin, accountId: string): void {
  if (admin.role === "super") return;
  if (admin.accountId !== accountId) {
    throw new AuthError(403, "Not authorised for this account");
  }
}

// Looks up the machine's account_id and checks it against the admin.
// Throws 404 if the machine_kb row doesn't exist (consistent with what
// callers would otherwise hit downstream) and 403 if the machine
// belongs to a different account. Returns the account_id so callers
// that need it (e.g. ingest) don't have to re-query.
export async function assertMachineAccess(
  admin: Admin,
  machineId: string,
): Promise<string> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("account_id")
    .eq("machine_id", machineId)
    .maybeSingle();

  if (error) {
    console.error("assertMachineAccess lookup failed:", error);
    throw new AuthError(500, "Database error");
  }
  if (!data) {
    throw new AuthError(404, "Machine not found");
  }
  const accountId = (data as { account_id: string }).account_id;
  assertAccountAccess(admin, accountId);
  return accountId;
}

// Looks up the document's machine, then the machine's account, and
// checks scope. Throws 404 if the document doesn't exist. Returns
// { machineId, accountId } for callers that need them.
export async function assertDocumentAccess(
  admin: Admin,
  documentId: string,
): Promise<{ machineId: string; accountId: string }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("kb_documents")
    .select("machine_id, machine_kb!inner(account_id)")
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    console.error("assertDocumentAccess lookup failed:", error);
    throw new AuthError(500, "Database error");
  }
  if (!data) {
    throw new AuthError(404, "Document not found");
  }
  // PostgREST returns the joined row as an object (because of !inner +
  // 1:1) but typings sometimes infer it as an array. Handle both.
  const row = data as {
    machine_id: string;
    machine_kb:
      | { account_id: string }
      | { account_id: string }[]
      | null;
  };
  const accountId = Array.isArray(row.machine_kb)
    ? row.machine_kb[0]?.account_id
    : row.machine_kb?.account_id;
  if (!accountId) {
    throw new AuthError(404, "Document not found");
  }
  assertAccountAccess(admin, accountId);
  return { machineId: row.machine_id, accountId };
}

// Same shape as assertDocumentAccess for the conversations table. Used
// by /api/admin/conversations/[id].
export async function assertConversationAccess(
  admin: Admin,
  conversationId: string,
): Promise<{ machineId: string; accountId: string }> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("machine_id, account_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    console.error("assertConversationAccess lookup failed:", error);
    throw new AuthError(500, "Database error");
  }
  if (!data) {
    throw new AuthError(404, "Conversation not found");
  }
  const row = data as { machine_id: string; account_id: string };
  assertAccountAccess(admin, row.account_id);
  return { machineId: row.machine_id, accountId: row.account_id };
}
