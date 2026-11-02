// GET /api/qr/stickers/[token] (public). Status of a pre-printed sticker
// for the /q/[token] scan page: unknown, retired, unclaimed (activation
// flow) or linked (redirect into chat via the existing /?qr= flow).
//
// The token is the secret printed on the sticker, so a linked sticker
// may reveal its machine here just as /api/qr/resolve does.

import {
  findSticker,
  formatStickerCode,
  isPlausibleStickerToken,
  joinedMachine,
} from "@/lib/qrStickers";
import type { QrStickerLookupResponse } from "@/lib/qrStickerTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const unknown: QrStickerLookupResponse = { status: "unknown" };
  if (!isPlausibleStickerToken(token)) return Response.json(unknown);

  let row;
  try {
    row = await findSticker({ token });
  } catch {
    return Response.json({ error: "Database error" }, { status: 500 });
  }
  if (!row) return Response.json(unknown);

  const code = formatStickerCode(row.code);
  let result: QrStickerLookupResponse;
  if (row.retired_at) {
    result = { status: "retired", code };
  } else if (row.machine_id) {
    const machine = joinedMachine(row);
    result = {
      status: "linked",
      code,
      machineId: row.machine_id,
      accountId: machine?.account_id ?? row.account_id ?? "",
      machineName: machine?.display_name ?? null,
    };
  } else {
    result = { status: "unclaimed", code, accountId: row.account_id };
  }
  return Response.json(result);
}
