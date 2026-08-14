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

// Translation keys for usage_events.operation values. Unknown operations
// (added later server-side) fall through to the raw slug so they still
// show up rather than vanishing.
const OPERATION_KEYS: Record<string, string> = {
  chat: "opChat",
  embedding: "opEmbedding",
  pdf_ocr: "opPdfOcr",
  image_caption: "opImageCaption",
  figure_extraction: "opFigureExtraction",
  suggestions: "opSuggestions",
  auto_organize: "opAutoOrganize",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// Token usage for one account over the last 30 days: totals up top,
// per-operation/model breakdown below. Read-only — rows are written by
// src/lib/usage.ts at every AI call.
export function AccountUsageSection({ accountId }: { accountId: string }) {
  const t = useTranslations("admin.accountUsage");
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

  const { totals, rows, days } = data;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-[var(--color-muted-foreground)]">
        {t("description", { days })}
      </p>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-4">
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
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}
