// PATCH /api/admin/qr-stickers/[id]: { action: "unlink" | "retire" }
//
// Unlink frees a sticker for another machine. It keeps account_id, so
// the sticker stays with the customer it was bound to. Retire kills a
// damaged or lost sticker for good; its token stops granting access at
// once. Both are idempotent.
//
// Account admins may only act on stickers bound to their own account.
// Global pool stickers are for super admins to retire.

import { AuthError, requireAdmin } from "@/lib/auth";
import {
  findSticker,
  rowToQrSticker,
  STICKER_SELECT,
  type QrStickerRow,
} from "@/lib/qrStickers";
import type { UpdateQrStickerResponse } from "@/lib/qrStickerTypes";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const { id } = await ctx.params;

  let body: { action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body.action;
  if (action !== "unlink" && action !== "retire") {
    return Response.json(
      { error: 'action must be "unlink" or "retire"' },
      { status: 400 },
    );
  }

  const notFound = Response.json(
    { error: "Sticker not found" },
    { status: 404 },
  );
  if (!UUID_RE.test(id)) return notFound;

  let row: QrStickerRow | null;
  try {
    row = await findSticker({ id });
  } catch {
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!row) return notFound;
  if (admin.role === "account" && row.account_id !== admin.accountId) {
    return notFound;
  }

  // Already in the requested state: nothing to write.
  if (
    (action === "retire" && row.retired_at) ||
    (action === "unlink" && !row.machine_id && !row.retired_at)
  ) {
    const result: UpdateQrStickerResponse = { sticker: rowToQrSticker(row) };
    return Response.json(result);
  }
  if (action === "unlink" && row.retired_at) {
    return Response.json(
      { error: "Sticker is retired", code: "retired" },
      { status: 409 },
    );
  }

  // Retire keeps machine_id and linked_at as history; resolveQrToken
  // ignores retired stickers regardless.
  const patch =
    action === "retire"
      ? { retired_at: new Date().toISOString() }
      : { machine_id: null, linked_at: null, linked_by: null };

  const supabase = getSupabaseServerClient();
  // Guard on the state we just read: an unlink from a stale screen must
  // not pull a sticker off a machine another admin has since moved it to.
  let update = supabase
    .from("qr_stickers")
    .update(patch)
    .eq("id", row.id)
    .is("retired_at", null);
  update = row.machine_id
    ? update.eq("machine_id", row.machine_id)
    : update.is("machine_id", null);
  const { data, error } = await update.select(STICKER_SELECT).maybeSingle();

  if (error) {
    console.error(`admin qr-stickers ${action} failed:`, error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!data) {
    return Response.json(
      { error: "Sticker changed in the meantime", code: "conflict" },
      { status: 409 },
    );
  }

  const result: UpdateQrStickerResponse = {
    sticker: rowToQrSticker(data as QrStickerRow),
  };
  return Response.json(result);
}
