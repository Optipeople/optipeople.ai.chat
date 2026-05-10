import { fetchWithAuth } from "./authApi";

const CURRENT_USER_URL = "/auth-api/User/GetCurrentUser";

export type CurrentUser = {
  id: string;
  email: string;
  // Human-readable role label (e.g. "Super Administrator"). Null if the
  // upstream payload didn't carry it.
  roleName: string | null;
  // Stable code-style identifier (e.g. "SuperAdministrator"). This is what
  // requireSuperAdmin gates on — no spaces, predictable casing.
  permissionName: string | null;
};

// Optipeople's GetCurrentUser flattens the User shape and adds extra
// view-model fields like roleName / permissionName / accountName. Names
// of the relevant fields confirmed against the live response.
type RawUser = {
  id?: string;
  email?: string;
  roleName?: string | null;
  permissionName?: string | null;
};

type ApiError = { title?: string; message?: string };
type ApiEnvelope = {
  data?: RawUser | null;
  errors?: ApiError[] | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const res = await fetchWithAuth(CURRENT_USER_URL);
  if (!res.ok) return null;

  const body = (await res.json()) as ApiEnvelope;
  const raw = body.data;
  if (!raw || !raw.id || !raw.email) return null;

  return {
    id: raw.id,
    email: raw.email,
    roleName: raw.roleName ?? null,
    permissionName: raw.permissionName ?? null,
  };
}
