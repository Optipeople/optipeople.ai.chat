// Identity resolution for the operator-facing (non-admin) endpoints.
//
// The chat stack accepts two auth shapes: an Optipeople bearer token, or
// a machine QR token for shop-floor sticker access. Both resolve to a
// `user_id` that conversations are written under — real Optipeople ids
// for logged-in users, `qr:<token-suffix>` pseudo-ids for sticker
// sessions. Routes that read a user's own history need exactly that id
// plus, for QR, the machine the session is pinned to.
//
// Bearer wins when both are present, matching /api/chat.

import { AuthError, resolveCurrentUser } from "./auth";
import { readQrTokenFromRequest, resolveQrToken } from "./qrAuth";

export type OperatorIdentity = {
  userId: string;
  // Set only for QR sessions. Every query the caller makes must be
  // constrained to this machine — a sticker grants access to one
  // machine, never the account.
  qrMachineId: string | null;
};

// Throws AuthError on failure; catch + .toResponse() in the handler.
export async function resolveOperator(req: Request): Promise<OperatorIdentity> {
  const hasBearer = /^Bearer\s/i.test(req.headers.get("authorization") ?? "");
  if (hasBearer) {
    const user = await resolveCurrentUser(req);
    return { userId: user.userId, qrMachineId: null };
  }

  const url = new URL(req.url);
  const qrToken =
    readQrTokenFromRequest(req, null) ?? url.searchParams.get("qrToken");
  if (!qrToken) {
    throw new AuthError(401, "Missing or malformed Authorization header");
  }
  const session = await resolveQrToken(qrToken);
  if (!session) {
    throw new AuthError(401, "Invalid or revoked QR token");
  }
  return { userId: session.userId, qrMachineId: session.machineId };
}
