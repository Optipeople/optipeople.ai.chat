// GET /api/qr/resolve?token=<token>
//
// Public endpoint — the QR token IS the authorization. Used by the
// client on first load to look up which machine the sticker maps to,
// so it can skip login + pickers and jump straight into chat.

import { resolveQrToken } from "@/lib/qrAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type QrResolveResponse = {
  machineId: string;
  accountId: string;
  machineName: string | null;
};

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return Response.json({ error: "token is required" }, { status: 400 });
  }

  const session = await resolveQrToken(token);
  if (!session) {
    return Response.json(
      { error: "Invalid or revoked QR token" },
      { status: 404 },
    );
  }

  const result: QrResolveResponse = {
    machineId: session.machineId,
    accountId: session.accountId,
    machineName: session.machineName,
  };
  return Response.json(result);
}
