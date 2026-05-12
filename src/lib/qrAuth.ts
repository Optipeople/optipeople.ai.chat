// QR-token authorization for the operator endpoints.
//
// The QR token (machine_kb.qr_token) IS the authorization: anyone with
// the sticker scan can chat for that machine, no Optipeople login. We
// resolve the token to a synthetic user shape that mirrors
// CurrentUserDetails so the rest of the chat stack doesn't have to
// branch on auth source.

import { getSupabaseServerClient } from "./supabase";

export type QrSession = {
  // Pseudo identity for audit. user_id is qr:<token-prefix> so audit
  // views can distinguish QR sessions from real users at a glance,
  // while still grouping all chats from the same sticker together.
  userId: string;
  email: string | null;
  name: string;
  machineId: string;
  accountId: string;
  machineName: string | null;
};

// Stable pseudo-id derived from the token. Same sticker = same user_id
// across sessions, which is useful when reading the audit log.
function tokenToPseudoUserId(token: string): string {
  // Use the last 12 chars — enough entropy to disambiguate, short
  // enough to read in audit views.
  return `qr:${token.slice(-12)}`;
}

export async function resolveQrToken(
  token: string,
): Promise<QrSession | null> {
  if (!token || token.length < 16) return null;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("machine_id, account_id, display_name")
    .eq("qr_token", token)
    .maybeSingle();

  if (error) {
    console.error("resolveQrToken: lookup failed:", error);
    return null;
  }
  if (!data) return null;

  const row = data as {
    machine_id: string;
    account_id: string;
    display_name: string | null;
  };

  return {
    userId: tokenToPseudoUserId(token),
    email: null,
    name: row.display_name ?? "QR operator",
    machineId: row.machine_id,
    accountId: row.account_id,
    machineName: row.display_name,
  };
}

// Convenience: extract token from request (header `X-QR-Token` first,
// then `qrToken` body field — caller already-parsed body is passed in).
export function readQrTokenFromRequest(
  req: Request,
  body?: { qrToken?: unknown } | null,
): string | null {
  const headerToken = req.headers.get("x-qr-token");
  if (typeof headerToken === "string" && headerToken.length > 0) {
    return headerToken;
  }
  if (body && typeof body.qrToken === "string" && body.qrToken.length > 0) {
    return body.qrToken;
  }
  return null;
}
