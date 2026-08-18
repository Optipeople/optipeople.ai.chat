// GET /api/admin/accounts/[accountId]/usage?days=30 — token usage for
// one account, grouped by operation + model, plus totals.
//
// Backed by the usage_account_summary RPC over usage_events, so the
// aggregation runs next to the data. Super admins see any account;
// account admins only their own (assertAccountAccess).

import { getTranslations } from "next-intl/server";
import { AuthError, assertAccountAccess, requireAdmin } from "@/lib/auth";
import { costUsd, totalCostUsd } from "@/lib/pricing";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export type AdminUsageRow = {
  operation: string;
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** USD, or null when we have no price for this model (see lib/pricing). */
  costUsd: number | null;
};

export type AdminUsageTotals = Omit<
  AdminUsageRow,
  "operation" | "model" | "costUsd"
> & {
  costUsd: number;
  /** Rows excluded from costUsd because the model has no price entry. */
  unpricedRows: number;
};

export type AdminAccountUsageResponse = {
  accountId: string;
  days: number;
  totals: AdminUsageTotals;
  rows: AdminUsageRow[];
};

type SummaryRow = {
  operation: string;
  model: string;
  events: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;
  try {
    const user = await requireAdmin(req);
    assertAccountAccess(user, accountId);
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
  const { data, error } = await supabase.rpc("usage_account_summary", {
    p_account_id: accountId,
    p_since: since,
  });

  if (error) {
    console.error("admin usage GET failed:", error);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }

  const rows: AdminUsageRow[] = ((data ?? []) as SummaryRow[]).map((r) => {
    const row = {
      operation: r.operation,
      model: r.model,
      events: Number(r.events),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
    };
    return { ...row, costUsd: costUsd(row) };
  });

  const cost = totalCostUsd(rows);
  const totals: AdminUsageTotals = rows.reduce(
    (acc, r) => ({
      ...acc,
      events: acc.events + r.events,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.cacheWriteTokens,
    }),
    {
      events: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: cost.usd,
      unpricedRows: cost.unpricedRows,
    },
  );

  const result: AdminAccountUsageResponse = { accountId, days, totals, rows };
  return Response.json(result);
}
