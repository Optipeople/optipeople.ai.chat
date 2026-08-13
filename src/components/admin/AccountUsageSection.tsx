"use client";

import { useEffect, useState } from "react";
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

// Human labels for usage_events.operation values. Unknown operations
// (added later server-side) fall through to the raw slug so they still
// show up rather than vanishing.
const OPERATION_LABELS: Record<string, string> = {
  chat: "Chat",
  embedding: "Embeddings (search & ingest)",
  pdf_ocr: "PDF OCR",
  image_caption: "Image captions",
  figure_extraction: "Figure extraction",
  suggestions: "Starter questions",
  auto_organize: "Auto-organize",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// Token usage for one account over the last 30 days: totals up top,
// per-operation/model breakdown below. Read-only — rows are written by
// src/lib/usage.ts at every AI call.
export function AccountUsageSection({ accountId }: { accountId: string }) {
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
          setError(err instanceof Error ? err.message : "Kunne ikke hente forbrug");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

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
        AI token usage across chat, document ingestion and search for the
        last {days} days.
      </p>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-4">
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">Input tokens</dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {fmt(totals.inputTokens)}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">Output tokens</dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {fmt(totals.outputTokens)}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
            Cache tokens
            <HelpHint
              size={16}
              content="Prompt-cache traffic on chat calls: tokens read from the cache (billed at a fraction of input price) and tokens written to it."
            />
          </dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {fmt(totals.cacheReadTokens)} read / {fmt(totals.cacheWriteTokens)}{" "}
            written
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">API calls</dt>
          <dd className="tabular-nums text-[var(--color-foreground)]">
            {fmt(totals.events)}
          </dd>
        </div>
      </dl>

      {rows.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-center text-[14px] text-[var(--color-muted-foreground)]">
          No AI usage recorded in the last {days} days.
        </div>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableHeader>Operation</DataTableHeader>
            <DataTableHeader>Model</DataTableHeader>
            <DataTableHeader align="right">Calls</DataTableHeader>
            <DataTableHeader align="right">Input</DataTableHeader>
            <DataTableHeader align="right">Output</DataTableHeader>
            <DataTableHeader align="right">Cache read</DataTableHeader>
          </DataTableHead>
          <DataTableBody>
            {rows.map((r) => (
              <DataTableRow key={`${r.operation}:${r.model}`}>
                <DataTableCell>
                  {OPERATION_LABELS[r.operation] ?? r.operation}
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
