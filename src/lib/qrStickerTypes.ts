// Shared contract for pre-printed QR stickers (see docs/qr-sticker-pool-plan.md).
// Types only, so both server routes and client components can import it.

export type QrStickerStatus = "unclaimed" | "linked" | "retired";

export type QrSticker = {
  id: string;
  // Human code printed under the QR, e.g. "7F3K-9PQX". Used by admins to
  // look a sticker up by hand. Never grants chat access on its own.
  code: string;
  // Random secret carried in the sticker URL (/q/<token>). Grants chat
  // access once linked, exactly like machine_kb.qr_token.
  token: string;
  batchId: string;
  status: QrStickerStatus;
  // Account the sticker is reserved for (set at batch creation) or bound
  // to (set on first claim). Null for stickers still in the global pool.
  accountId: string | null;
  machineId: string | null;
  machineName: string | null;
  linkedAt: string | null;
  linkedBy: string | null;
  createdAt: string;
};

export type QrStickerBatch = {
  id: string;
  label: string;
  accountId: string | null;
  count: number;
  linkedCount: number;
  retiredCount: number;
  createdAt: string;
  createdBy: string | null;
};

// GET /api/qr/stickers/[token] (public). Linked stickers also carry the
// machine so the scan page can redirect straight into chat.
export type QrStickerLookupResponse =
  | { status: "unknown" }
  | { status: "retired"; code: string }
  | { status: "unclaimed"; code: string; accountId: string | null }
  | {
      status: "linked";
      code: string;
      machineId: string;
      accountId: string;
      machineName: string | null;
    };

// POST /api/admin/qr-stickers/batches body / response
export type CreateQrStickerBatchRequest = {
  label: string;
  count: number; // 1 to 1000
  accountId?: string | null;
};
export type CreateQrStickerBatchResponse = {
  batch: QrStickerBatch;
  stickers: QrSticker[];
};

// GET /api/admin/qr-stickers/batches
export type ListQrStickerBatchesResponse = { batches: QrStickerBatch[] };

// GET /api/admin/qr-stickers/batches/[id]
export type GetQrStickerBatchResponse = {
  batch: QrStickerBatch;
  stickers: QrSticker[];
};

// GET /api/admin/qr-stickers/lookup?code=XXXX-XXXX or ?token=...
export type LookupQrStickerResponse = { sticker: QrSticker };

// POST /api/admin/qr-stickers/link
// Identify the sticker by token (scan flow) or code (typed by hand).
// Re-linking an already linked sticker requires reassign: true.
export type LinkQrStickerRequest = {
  token?: string;
  code?: string;
  machineId: string;
  reassign?: boolean;
};
export type LinkQrStickerResponse = { sticker: QrSticker };

// PATCH /api/admin/qr-stickers/[id]
export type UpdateQrStickerRequest = { action: "unlink" | "retire" };
export type UpdateQrStickerResponse = { sticker: QrSticker };

// GET /api/admin/machines/[id]/qr-stickers
export type MachineQrStickersResponse = { stickers: QrSticker[] };

// POST /api/admin/machines/qr-bulk
// Mints a machine_kb.qr_token for every listed machine that lacks one,
// and returns the token for all of them, for bulk printing named stickers.
export type BulkMachineQrRequest = { machineIds: string[] };
export type BulkMachineQrResponse = {
  machines: { machineId: string; displayName: string | null; token: string }[];
};
