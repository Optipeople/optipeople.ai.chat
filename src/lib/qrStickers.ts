// Server helpers for pre-printed QR stickers (docs/qr-sticker-pool-plan.md).
//
// Tokens and codes are minted here, rows are mapped to the shared
// contract in qrStickerTypes.ts, and the admin routes share the lookup
// and scoping rules. Server only: imports the service role client.

import { randomBytes } from "node:crypto";
import type { Admin } from "./auth";
import type {
  QrSticker,
  QrStickerBatch,
  QrStickerStatus,
} from "./qrStickerTypes";
import { getSupabaseServerClient } from "./supabase";

// No 0/O or 1/I, so a code read off a scratched sticker is unambiguous.
// 32 symbols, which also keeps the byte to symbol mapping unbiased.
export const STICKER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const STICKER_CODE_LENGTH = 8;

export const MAX_BATCH_SIZE = 1000;

// 16 random bytes, 22-char base64url. Shorter than the per-machine token
// so the pre-printed QR stays small, still far past brute-force range.
export function mintStickerToken(): string {
  return randomBytes(16).toString("base64url");
}

// 8 chars from STICKER_CODE_ALPHABET, stored without the dash.
export function mintStickerCode(): string {
  const bytes = randomBytes(STICKER_CODE_LENGTH);
  let code = "";
  for (const b of bytes) code += STICKER_CODE_ALPHABET[b & 31];
  return code;
}

// Stored form (7F3K9PQX) to display form (7F3K-9PQX).
export function formatStickerCode(code: string): string {
  if (code.length !== STICKER_CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// Normalise typed input: uppercase, strip dashes and whitespace. Returns
// null when the result cannot be a valid code, so routes can 400 or 404
// without a database round trip.
export function normalizeStickerCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== STICKER_CODE_LENGTH) return null;
  for (const ch of code) {
    if (!STICKER_CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}

// Cheap shape check before touching the database. Accepts any base64url
// string of plausible length, not only the 22-char sticker tokens.
export function isPlausibleStickerToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

// Column list every sticker query selects, including the machine name.
export const STICKER_SELECT =
  "id, batch_id, code, token, account_id, machine_id, linked_at, linked_by, retired_at, created_at, machine_kb(display_name, account_id)";

type JoinedMachine = { display_name: string | null; account_id: string };

export type QrStickerRow = {
  id: string;
  batch_id: string;
  code: string;
  token: string;
  account_id: string | null;
  machine_id: string | null;
  linked_at: string | null;
  linked_by: string | null;
  retired_at: string | null;
  created_at: string;
  machine_kb?: JoinedMachine | JoinedMachine[] | null;
};

// PostgREST returns a to-one embed as an object, but typings sometimes
// infer an array. Handle both.
export function joinedMachine(row: QrStickerRow): JoinedMachine | null {
  const m = row.machine_kb;
  if (!m) return null;
  return Array.isArray(m) ? (m[0] ?? null) : m;
}

export function stickerStatus(row: {
  machine_id: string | null;
  retired_at: string | null;
}): QrStickerStatus {
  if (row.retired_at) return "retired";
  if (row.machine_id) return "linked";
  return "unclaimed";
}

export function rowToQrSticker(row: QrStickerRow): QrSticker {
  return {
    id: row.id,
    code: formatStickerCode(row.code),
    token: row.token,
    batchId: row.batch_id,
    status: stickerStatus(row),
    accountId: row.account_id,
    machineId: row.machine_id,
    machineName: joinedMachine(row)?.display_name ?? null,
    linkedAt: row.linked_at,
    linkedBy: row.linked_by,
    createdAt: row.created_at,
  };
}

export type QrStickerBatchStatsRow = {
  id: string;
  label: string;
  account_id: string | null;
  created_by: string | null;
  created_at: string;
  sticker_count: number;
  linked_count: number;
  retired_count: number;
};

export const BATCH_STATS_SELECT =
  "id, label, account_id, created_by, created_at, sticker_count, linked_count, retired_count";

export function statsRowToBatch(row: QrStickerBatchStatsRow): QrStickerBatch {
  return {
    id: row.id,
    label: row.label,
    accountId: row.account_id,
    count: row.sticker_count,
    linkedCount: row.linked_count,
    retiredCount: row.retired_count,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

// Account admins only see stickers still in the global pool or bound to
// their own account. Everything else is reported as not found, so they
// cannot probe other customers' codes.
export function adminCanSeeSticker(
  admin: Admin,
  row: { account_id: string | null },
): boolean {
  if (admin.role === "super") return true;
  return row.account_id === null || row.account_id === admin.accountId;
}

export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// One sticker by id, token or code (code already normalised). Returns
// null when nothing matches; throws on a database error.
export async function findSticker(
  by: { id: string } | { token: string } | { code: string },
): Promise<QrStickerRow | null> {
  const supabase = getSupabaseServerClient();
  const query = supabase.from("qr_stickers").select(STICKER_SELECT);
  const filtered =
    "id" in by
      ? query.eq("id", by.id)
      : "token" in by
        ? query.eq("token", by.token)
        : query.eq("code", by.code);
  const { data, error } = await filtered.maybeSingle();
  if (error) {
    console.error("findSticker lookup failed:", error);
    throw new Error("Database error");
  }
  return (data as QrStickerRow | null) ?? null;
}

// Inserts `count` fresh stickers for a batch in one statement. A bulk
// insert is all or nothing, so on a code or token collision with an
// existing row the whole set is minted again. With 32^8 codes that
// practically never happens; three attempts is plenty.
export async function insertBatchStickers(
  batchId: string,
  accountId: string | null,
  count: number,
): Promise<QrStickerRow[]> {
  const supabase = getSupabaseServerClient();
  for (let attempt = 0; attempt < 3; attempt++) {
    const codes = new Set<string>();
    while (codes.size < count) codes.add(mintStickerCode());
    const rows = [...codes].map((code) => ({
      batch_id: batchId,
      code,
      token: mintStickerToken(),
      account_id: accountId,
    }));
    const { data, error } = await supabase
      .from("qr_stickers")
      .insert(rows)
      .select(STICKER_SELECT);
    if (!error) return (data ?? []) as QrStickerRow[];
    if (!isUniqueViolation(error)) {
      console.error("insertBatchStickers failed:", error);
      throw new Error("Database error");
    }
  }
  throw new Error("Could not mint unique sticker codes");
}
