// GET /api/admin/usage?days=30 — token totals per account, for the
// admin accounts list. Super admins get every account with recorded
// usage; account admins get (at most) the single row for their own.

import { getTranslations } from "next-intl/server";
import { AuthError, requireAdmin, type Admin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export type AdminUsageOverviewRow = {
  accountId: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type AdminUsageOverviewResponse = {
  days: number;
  accounts: AdminUsageOverviewRow[];
};

type OverviewRow = {
  account_id: string;
  events: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

export async function GET(req: Request) {
  let admin: Admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(daysRaw)
    ? Math.min(Math.max(Math.floor(daysRaw), 1), MAX_DAYS)
    : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("usage_accounts_overview", {
    p_since: since,
  });

  if (error) {
    console.error("admin usage overview GET failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  let rows = (data ?? []) as OverviewRow[];
  if (admin.role === "account") {
    rows = rows.filter((r) => r.account_id === admin.accountId);
  }

  const result: AdminUsageOverviewResponse = {
    days,
    accounts: rows.map((r) => ({
      accountId: r.account_id,
      events: Number(r.events),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
    })),
  };
  return Response.json(result);
}
