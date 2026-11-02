// GET  /api/admin/qr-stickers/batches: list sticker batches with counts.
// POST /api/admin/qr-stickers/batches: create a batch of 1 to 1000
//                                      stickers, optionally reserved for
//                                      one account. Returns the stickers
//                                      so the client can print them.
//
// Super admins (and partners) only: batches span customers.

import { AuthError, requireSuperAdmin, type SuperAdmin } from "@/lib/auth";
import {
  BATCH_STATS_SELECT,
  insertBatchStickers,
  MAX_BATCH_SIZE,
  rowToQrSticker,
  statsRowToBatch,
  type QrStickerBatchStatsRow,
} from "@/lib/qrStickers";
import type {
  CreateQrStickerBatchResponse,
  ListQrStickerBatchesResponse,
} from "@/lib/qrStickerTypes";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(
  req: Request,
): Promise<{ admin: SuperAdmin | null; denied: Response | null }> {
  try {
    const admin = await requireSuperAdmin(req);
    return { admin, denied: null };
  } catch (err) {
    if (err instanceof AuthError) return { admin: null, denied: err.toResponse() };
    throw err;
  }
}

export async function GET(req: Request) {
  const { denied } = await gate(req);
  if (denied) return denied;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("qr_sticker_batch_stats")
    .select(BATCH_STATS_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("admin qr-stickers batches GET failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const result: ListQrStickerBatchesResponse = {
    batches: ((data ?? []) as QrStickerBatchStatsRow[]).map(statsRowToBatch),
  };
  return Response.json(result);
}

export async function POST(req: Request) {
  const { admin, denied } = await gate(req);
  if (denied) return denied;

  let body: { label?: unknown; count?: unknown; accountId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  const count = body.count;
  const accountId =
    typeof body.accountId === "string" && body.accountId.trim().length > 0
      ? body.accountId.trim()
      : null;

  if (!label) {
    return Response.json({ error: "label is required" }, { status: 400 });
  }
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_BATCH_SIZE
  ) {
    return Response.json(
      { error: `count must be an integer from 1 to ${MAX_BATCH_SIZE}` },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();
  const { data: batchRow, error: bErr } = await supabase
    .from("qr_sticker_batches")
    .insert({ label, account_id: accountId, created_by: admin!.email })
    .select("id, label, account_id, created_by, created_at")
    .single();

  if (bErr || !batchRow) {
    console.error("admin qr-stickers batch insert failed:", bErr);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  const batch = batchRow as Omit<
    QrStickerBatchStatsRow,
    "sticker_count" | "linked_count" | "retired_count"
  >;

  let stickers;
  try {
    stickers = await insertBatchStickers(batch.id, accountId, count);
  } catch (err) {
    console.error("admin qr-stickers sticker insert failed:", err);
    // Do not leave an empty batch behind.
    await supabase.from("qr_sticker_batches").delete().eq("id", batch.id);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const result: CreateQrStickerBatchResponse = {
    batch: statsRowToBatch({
      ...batch,
      sticker_count: stickers.length,
      linked_count: 0,
      retired_count: 0,
    }),
    stickers: stickers.map(rowToQrSticker),
  };
  return Response.json(result, { status: 201 });
}
