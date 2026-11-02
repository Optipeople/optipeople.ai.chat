// GET /api/admin/qr-stickers/batches/[id]: one batch with all its
// stickers, ordered by code. Feeds the print PDF and the CSV export.
//
// Super admins (and partners) only.

import { AuthError, requireSuperAdmin } from "@/lib/auth";
import {
  BATCH_STATS_SELECT,
  rowToQrSticker,
  statsRowToBatch,
  STICKER_SELECT,
  type QrStickerBatchStatsRow,
  type QrStickerRow,
} from "@/lib/qrStickers";
import type { GetQrStickerBatchResponse } from "@/lib/qrStickerTypes";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Batch not found" }, { status: 404 });
  }

  const supabase = getSupabaseServerClient();
  const [{ data: batch, error: bErr }, { data: stickers, error: sErr }] =
    await Promise.all([
      supabase
        .from("qr_sticker_batch_stats")
        .select(BATCH_STATS_SELECT)
        .eq("id", id)
        .maybeSingle(),
      // Batches are capped at 1000 stickers, which fits the row limit.
      supabase
        .from("qr_stickers")
        .select(STICKER_SELECT)
        .eq("batch_id", id)
        .order("code", { ascending: true }),
    ]);

  if (bErr || sErr) {
    console.error("admin qr-stickers batch GET failed:", bErr, sErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!batch) {
    return Response.json({ error: "Batch not found" }, { status: 404 });
  }

  const result: GetQrStickerBatchResponse = {
    batch: statsRowToBatch(batch as QrStickerBatchStatsRow),
    stickers: ((stickers ?? []) as QrStickerRow[]).map(rowToQrSticker),
  };
  return Response.json(result);
}
