// GET /api/admin/usage?days=30 — token totals per account, for the
// admin accounts list. Super admins get every account with recorded
// usage; account admins get (at most) the single row for their own.

import { getTranslations } from "next-intl/server";
import { AuthError, requireAdmin, type Admin } from "@/lib/auth";
import { costUsd } from "@/lib/pricing";
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
  /** USD across every priced model for this account. */
  costUsd: number;
  /** Rows excluded from costUsd because the model has no price entry. */
  unpricedRows: number;
};

export type AdminUsageOverviewResponse = {
  days: number;
  accounts: AdminUsageOverviewRow[];
};

// One row per (account, operation, model) — the grain pricing needs.
type BreakdownRow = {
  account_id: string;
  operation: string;
  model: string;
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
  const { data, error } = await supabase.rpc("usage_accounts_breakdown", {
    p_since: since,
  });

  if (error) {
    console.error("admin usage overview GET failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  let rows = (data ?? []) as BreakdownRow[];
  if (admin.role === "account") {
    rows = rows.filter((r) => r.account_id === admin.accountId);
  }

  // Collapse the per-model breakdown into one row per account, pricing each
  // model's slice before summing. Cost has to be computed at the model
  // grain and only then aggregated.
  const byAccount = new Map<string, AdminUsageOverviewRow>();
  for (const r of rows) {
    const slice = {
      operation: r.operation,
      model: r.model,
      events: Number(r.events),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
    };
    const cost = costUsd(slice);
    const acc = byAccount.get(r.account_id) ?? {
      accountId: r.account_id,
      events: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      unpricedRows: 0,
    };
    acc.events += slice.events;
    acc.inputTokens += slice.inputTokens;
    acc.outputTokens += slice.outputTokens;
    acc.cacheReadTokens += slice.cacheReadTokens;
    acc.cacheWriteTokens += slice.cacheWriteTokens;
    if (cost === null) acc.unpricedRows++;
    else acc.costUsd += cost;
    byAccount.set(r.account_id, acc);
  }

  const result: AdminUsageOverviewResponse = {
    days,
    accounts: [...byAccount.values()],
  };
  return Response.json(result);
}
