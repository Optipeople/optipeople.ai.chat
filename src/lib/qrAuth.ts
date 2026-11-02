// QR-token authorization for the operator endpoints.
//
// The QR token (machine_kb.qr_token, or a linked qr_stickers.token) IS
// the authorization: anyone with the sticker scan can chat for that
// machine, no Optipeople login. We resolve the token to a synthetic
// user shape that mirrors CurrentUserDetails so the rest of the chat
// stack doesn't have to branch on auth source.

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
  // Use the last 12 chars: enough entropy to disambiguate, short
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
  if (!data) return resolveStickerToken(token);

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

// Fallback for pre-printed pool stickers (qr_stickers.token). Only a
// linked, unretired sticker grants access; the machine's own account is
// authoritative, read through the join rather than the sticker row.
async function resolveStickerToken(token: string): Promise<QrSession | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("qr_stickers")
    .select("machine_id, machine_kb!inner(account_id, display_name)")
    .eq("token", token)
    .not("machine_id", "is", null)
    .is("retired_at", null)
    .maybeSingle();

  if (error) {
    console.error("resolveQrToken: sticker lookup failed:", error);
    return null;
  }
  if (!data) return null;

  type Machine = { account_id: string; display_name: string | null };
  const row = data as {
    machine_id: string;
    machine_kb: Machine | Machine[] | null;
  };
  const machine = Array.isArray(row.machine_kb)
    ? row.machine_kb[0]
    : row.machine_kb;
  if (!machine) return null;

  return {
    // A pool sticker can move between machines (and accounts), so its
    // identity includes the machine: scans after a move must not share an
    // owner with the conversations from before it.
    userId: `${tokenToPseudoUserId(token)}:${row.machine_id}`,
    email: null,
    name: machine.display_name ?? "QR operator",
    machineId: row.machine_id,
    accountId: machine.account_id,
    machineName: machine.display_name,
  };
}

// Convenience: extract token from request (header `X-QR-Token` first,
// then `qrToken` body field; the caller passes its already-parsed body).
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
