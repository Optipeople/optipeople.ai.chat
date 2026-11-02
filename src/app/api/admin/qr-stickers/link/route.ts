// POST /api/admin/qr-stickers/link: link a sticker to a machine.
//
// The sticker is identified by token (scan flow) or code (typed by
// hand). Rules:
//   - retired stickers cannot be linked (409, code "retired");
//   - a sticker linked to another machine needs reassign: true, else 409
//     with code "already_linked" and, when the admin may see it, the
//     machine it is on now;
//   - linking to the machine it is already on is a no-op success;
//   - account admins may only link stickers in the global pool or bound
//     to their account, and only to their own machines.
// On link the sticker's account_id becomes the machine's account, so the
// sticker stays with that customer after an unlink.

import { assertMachineAccess, AuthError, requireAdmin } from "@/lib/auth";
import {
  adminCanSeeSticker,
  findSticker,
  isPlausibleStickerToken,
  joinedMachine,
  normalizeStickerCode,
  rowToQrSticker,
  STICKER_SELECT,
  type QrStickerRow,
} from "@/lib/qrStickers";
import type { LinkQrStickerResponse } from "@/lib/qrStickerTypes";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  let body: {
    token?: unknown;
    code?: unknown;
    machineId?: unknown;
    reassign?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const machineId =
    typeof body.machineId === "string" ? body.machineId.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const rawCode = typeof body.code === "string" ? body.code : "";
  const reassign = body.reassign === true;
  if (!machineId) {
    return Response.json({ error: "machineId is required" }, { status: 400 });
  }
  if (!token && !rawCode) {
    return Response.json(
      { error: "token or code is required" },
      { status: 400 },
    );
  }

  const notFound = Response.json(
    { error: "Sticker not found" },
    { status: 404 },
  );
  let by: { token: string } | { code: string };
  if (token) {
    if (!isPlausibleStickerToken(token)) return notFound;
    by = { token };
  } else {
    const code = normalizeStickerCode(rawCode);
    if (!code) return notFound;
    by = { code };
  }

  let row: QrStickerRow | null;
  try {
    row = await findSticker(by);
  } catch {
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!row || !adminCanSeeSticker(admin, row)) return notFound;

  if (row.retired_at) {
    return Response.json(
      { error: "Sticker is retired", code: "retired" },
      { status: 409 },
    );
  }

  let machineAccountId: string;
  try {
    machineAccountId = await assertMachineAccess(admin, machineId);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  if (row.machine_id === machineId) {
    const result: LinkQrStickerResponse = { sticker: rowToQrSticker(row) };
    return Response.json(result);
  }

  if (row.machine_id && !reassign) {
    const current = joinedMachine(row);
    const maySee =
      admin.role === "super" ||
      (current !== null && current.account_id === admin.accountId);
    return Response.json(
      {
        error: "Sticker is already linked to another machine",
        code: "already_linked",
        ...(maySee
          ? { machineId: row.machine_id, machineName: current?.display_name ?? null }
          : {}),
      },
      { status: 409 },
    );
  }

  // Guard on the state we just read, so two admins linking the same
  // sticker at once cannot silently overwrite each other.
  const supabase = getSupabaseServerClient();
  let update = supabase
    .from("qr_stickers")
    .update({
      machine_id: machineId,
      account_id: machineAccountId,
      linked_at: new Date().toISOString(),
      linked_by: admin.email,
    })
    .eq("id", row.id)
    .is("retired_at", null);
  update = row.machine_id
    ? update.eq("machine_id", row.machine_id)
    : update.is("machine_id", null);
  update = row.account_id
    ? update.eq("account_id", row.account_id)
    : update.is("account_id", null);
  const { data, error } = await update.select(STICKER_SELECT).maybeSingle();

  if (error) {
    console.error("admin qr-stickers link failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!data) {
    return Response.json(
      { error: "Sticker changed meanwhile, try again", code: "conflict" },
      { status: 409 },
    );
  }

  const result: LinkQrStickerResponse = {
    sticker: rowToQrSticker(data as QrStickerRow),
  };
  return Response.json(result);
}
