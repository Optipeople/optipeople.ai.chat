"use client";

import { useTranslations } from "next-intl";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table";
import { formatUsd } from "@/lib/pricing";
import type { AdminUsageRow } from "@/app/api/admin/accounts/[accountId]/usage/route";

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
  conversation_distill: "opConversationDistill",
  voice: "opVoice",
  transcription: "opTranscription",
  tts: "opTts",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// Usage grouped by operation + model: the account usage panel and the
// conversation detail both render their rows through this. The cost
// column is dollars — our cost basis — so it is shown to super admins
// only (see AccountUsageSection for why).
export function UsageBreakdownTable({
  rows,
  showCurrency,
}: {
  rows: AdminUsageRow[];
  showCurrency: boolean;
}) {
  const t = useTranslations("admin.accountUsage");
  return (
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
  );
}
