// GET /api/admin/qr-stickers/lookup?code=7F3K-9PQX
// GET /api/admin/qr-stickers/lookup?token=<token>
//
// Find one sticker, by the code typed off the label or by the token from
// a scan. Account admins only see stickers in the global pool or bound
// to their own account; anything else is a 404 so codes cannot be probed.

import { AuthError, requireAdmin } from "@/lib/auth";
import {
  adminCanSeeSticker,
  findSticker,
  isPlausibleStickerToken,
  normalizeStickerCode,
  rowToQrSticker,
} from "@/lib/qrStickers";
import type { LookupQrStickerResponse } from "@/lib/qrStickerTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const params = new URL(req.url).searchParams;
  const rawCode = params.get("code");
  const rawToken = params.get("token");
  if (!rawCode && !rawToken) {
    return Response.json(
      { error: "code or token is required" },
      { status: 400 },
    );
  }

  const notFound = Response.json(
    { error: "Sticker not found" },
    { status: 404 },
  );
  let by: { code: string } | { token: string };
  if (rawCode) {
    const code = normalizeStickerCode(rawCode);
    if (!code) return notFound;
    by = { code };
  } else {
    if (!isPlausibleStickerToken(rawToken!)) return notFound;
    by = { token: rawToken! };
  }

  let row;
  try {
    row = await findSticker(by);
  } catch {
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!row || !adminCanSeeSticker(admin, row)) return notFound;

  const result: LookupQrStickerResponse = { sticker: rowToQrSticker(row) };
  return Response.json(result);
}
