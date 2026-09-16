"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { HelpHint } from "@/components/ui/help-hint";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table";
import {
  getAdminAccountUsage,
  type AdminAccountUsageResponse,
} from "@/admin/adminApi";
import { formatUsd } from "@/lib/pricing";
import {
  CREDITS_PER_MACHINE_PER_MONTH,
  OVERAGE_BLOCK_CREDITS,
  OVERAGE_BLOCK_PRICE_DKK,
  formatCredits,
  formatDkk,
} from "@/lib/credits";
import { isSuperAdmin, useAuth } from "@/auth/AuthContext";

// Translation keys for usage_events.operation values. Unknown operations
// (added later server-side) fall through to the raw slug so they still
// show up rather than vanishing.
const OPERATION_KEYS: Record<string, string> = {
  chat: "opChat",
  embedding: "opEmbedding",
  pdf_ocr: "opPdfOcr",
  image_caption: "opImageCaption",
  figure_extraction: "opFigureExtraction",
  table_extraction: "opTableExtraction",
  doc_metadata: "opDocMetadata",
  suggestions: "opSuggestions",
  auto_organize: "opAutoOrganize",
  voice: "opVoice",
  transcription: "opTranscription",
  tts: "opTts",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// Token usage for one account over the last 30 days: totals up top,
// per-operation/model breakdown below. Read-only — rows are written by
// src/lib/usage.ts at every AI call.
export function AccountUsageSection({ accountId }: { accountId: string }) {
  const t = useTranslations("admin.accountUsage");
  const { user } = useAuth();
  // No money of any kind reaches a customer here. This panel is
  // reachable by an account admin, who IS the customer, and the product
  // deliberately speaks only one unit to them: credits. Dollars are our
  // cost basis and showing them would hand over our margin; kroner are
  // the price, and the invoice is raised outside the product, so a
  // figure here could only ever disagree with the one that actually
  // arrives. Credits used against the pool is what an account admin
  // needs to see, and it is enough to tell them they are heading over.
  const showCurrency = isSuperAdmin(user);
  const [data, setData] = useState<AdminAccountUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminAccountUsage(accountId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("loadFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  if (error) {
    return (
      <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-4 text-[14px] text-[var(--ds-red-dark)]">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const { totals, rows, days, credits } = data;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-[var(--color-muted-foreground)]">
        {t("description", { days })}
      </p>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-4">
        {/* Credits first: this is the billable view. The token figures
            below are how it was derived. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
            {t("creditsUsed")}
            <HelpHint
              size={16}
              content={t("creditsHelp", {
                perMachine: CREDITS_PER_MACHINE_PER_MONTH,
                machines: credits.machines,
              })}
            />
          </dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {t("creditsValue", {
              used: formatCredits(credits.usedCredits),
              included: formatCredits(credits.includedCredits),
            })}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
            {t("overage")}
            <HelpHint
              size={16}
              content={
                showCurrency
                  ? t("overageHelp", {
                      block: OVERAGE_BLOCK_CREDITS,
                      price: formatDkk(OVERAGE_BLOCK_PRICE_DKK),
                    })
                  : t("overageHelpCredits", { block: OVERAGE_BLOCK_CREDITS })
              }
            />
          </dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {credits.overageCredits === 0
              ? t("overageNone")
              : showCurrency
                ? t("overageValue", {
                    credits: formatCredits(credits.overageCredits),
                    amount: formatDkk(credits.overageDkk),
                  })
                : t("overageValueCredits", {
                    credits: formatCredits(credits.overageCredits),
                  })}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">
            {t("inputTokens")}
          </dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {fmt(totals.inputTokens)}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">
            {t("outputTokens")}
          </dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {fmt(totals.outputTokens)}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
            {t("cacheTokens")}
            <HelpHint size={16} content={t("cacheHelp")} />
          </dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {t("cacheValue", {
              read: fmt(totals.cacheReadTokens),
              written: fmt(totals.cacheWriteTokens),
            })}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">
            {t("apiCalls")}
          </dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {fmt(totals.events)}
          </dd>
        </div>
        {showCurrency && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
              {t("cost")}
              <HelpHint
                size={16}
                content={
                  totals.unpricedRows > 0
                    ? t("costHelpIncomplete", { models: totals.unpricedRows })
                    : t("costHelp")
                }
              />
            </dt>
            <dd className="tabular-nums text-[var(--color-foreground)]">
              {formatUsd(totals.costUsd)}
            </dd>
          </div>
        )}
      </dl>

      {rows.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {t("empty", { days })}
        </div>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableHeader>{t("colOperation")}</DataTableHeader>
            <DataTableHeader>{t("colModel")}</DataTableHeader>
            <DataTableHeader align="right">{t("colCalls")}</DataTableHeader>
            <DataTableHeader align="right">{t("colInput")}</DataTableHeader>
            <DataTableHeader align="right">{t("colOutput")}</DataTableHeader>
            <DataTableHeader align="right">{t("colCacheRead")}</DataTableHeader>
            {showCurrency && (
              <DataTableHeader align="right">{t("colCost")}</DataTableHeader>
            )}
          </DataTableHead>
          <DataTableBody>
            {rows.map((r) => (
              <DataTableRow key={`${r.operation}:${r.model}`}>
                <DataTableCell>
                  {OPERATION_KEYS[r.operation]
                    ? t(OPERATION_KEYS[r.operation])
                    : r.operation}
                </DataTableCell>
                <DataTableCell className="font-mono text-[12px]">
                  {r.model}
                </DataTableCell>
                <DataTableCell align="right" className="tabular-nums">
                  {fmt(r.events)}
                </DataTableCell>
                <DataTableCell align="right" className="tabular-nums">
                  {fmt(r.inputTokens)}
                </DataTableCell>
                <DataTableCell align="right" className="tabular-nums">
                  {fmt(r.outputTokens)}
                </DataTableCell>
                <DataTableCell align="right" className="tabular-nums">
                  {fmt(r.cacheReadTokens)}
                </DataTableCell>
                {showCurrency && (
                  <DataTableCell align="right" className="tabular-nums">
                    {r.costUsd === null ? "—" : formatUsd(r.costUsd)}
                  </DataTableCell>
                )}
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}
