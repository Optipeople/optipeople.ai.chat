// POST /api/admin/qr-stickers/retire: { ids: string[] }
//
// Retires many stickers at once, e.g. a lost roll or a misprinted run.
// Super admins only, like the batch screen it serves. Already retired
// stickers are left as they are, so the call is idempotent. Retire keeps
// machine_id and linked_at as history; resolveQrToken ignores retired
// stickers, so their tokens stop granting access at once.

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import {
  rowToQrSticker,
  STICKER_SELECT,
  type QrStickerRow,
} from "@/lib/qrStickers";
import type { RetireQrStickersResponse } from "@/lib/qrStickerTypes";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((v): v is string => typeof v === "string"))]
    : [];
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return Response.json(
      { error: `ids must hold 1 to ${MAX_IDS} sticker ids` },
      { status: 400 },
    );
  }
  if (!ids.every((id) => UUID_RE.test(id))) {
    return Response.json({ error: "Invalid sticker id" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error: updateError } = await supabase
    .from("qr_stickers")
    .update({ retired_at: new Date().toISOString() })
    .in("id", ids)
    .is("retired_at", null);
  if (updateError) {
    console.error("admin qr-stickers bulk retire failed:", updateError);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  // Return every requested sticker in its current state, including ones
  // that were already retired, so the client can refresh its rows.
  const { data, error } = await supabase
    .from("qr_stickers")
    .select(STICKER_SELECT)
    .in("id", ids);
  if (error) {
    console.error("admin qr-stickers bulk retire reload failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const result: RetireQrStickersResponse = {
    stickers: ((data ?? []) as QrStickerRow[]).map(rowToQrSticker),
  };
  return Response.json(result);
}
