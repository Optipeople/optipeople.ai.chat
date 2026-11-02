// GET /api/admin/machines/[id]/qr-stickers: pre-printed stickers
// currently linked to the machine, oldest link first. Retired stickers
// are left out; they no longer grant access and cannot be unlinked.

import { assertMachineAccess, AuthError, requireAdmin } from "@/lib/auth";
import {
  rowToQrSticker,
  STICKER_SELECT,
  type QrStickerRow,
} from "@/lib/qrStickers";
import type { MachineQrStickersResponse } from "@/lib/qrStickerTypes";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  try {
    const admin = await requireAdmin(req);
    await assertMachineAccess(admin, id);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("qr_stickers")
    .select(STICKER_SELECT)
    .eq("machine_id", id)
    .is("retired_at", null)
    .order("linked_at", { ascending: true });

  if (error) {
    console.error("admin machine qr-stickers GET failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const result: MachineQrStickersResponse = {
    stickers: ((data ?? []) as QrStickerRow[]).map(rowToQrSticker),
  };
  return Response.json(result);
}
