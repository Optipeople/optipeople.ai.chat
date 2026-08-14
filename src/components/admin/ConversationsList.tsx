"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { Tag, type TagVariant } from "@/components/ui/tag";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table";
import {
  adminErrorMessage,
  listAdminConversations,
  listAdminFleetConversations,
  type AdminConversationListItem,
  type AdminConversationResolutionFilter,
  type AdminConversationSort,
} from "@/admin/adminApi";

// What the list shows: one machine's conversations, or an account's
// fleet ("all machines") conversations — same columns, filters, and
// response shape; only the endpoint and the detail link differ.
export type ConversationsSource =
  | { kind: "machine"; machineId: string }
  | { kind: "fleet"; accountId: string };

const DA_DT = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "short",
  timeStyle: "short",
});

const PER_PAGE = 25;

function resolutionBadge(
  resolution: string | null,
  t: (key: string) => string,
): { label: string; variant: TagVariant } | null {
  switch (resolution) {
    case "resolved":
      return { label: t("resolutionResolved"), variant: "positive" };
    case "unresolved":
      return { label: t("resolutionUnresolved"), variant: "issue" };
    case "escalated":
      return { label: t("resolutionEscalated"), variant: "warning" };
    case "unknown":
      return { label: t("resolutionUnknown"), variant: "default" };
    default:
      return null;
  }
}

// QR-sticker sessions carry a pseudo identity (user_name "QR operator" /
// machine display name, user_id "qr:<suffix>") — show a localized label
// instead of leaking the raw pseudo-name into the audit views.
function isQrConversation(c: {
  entryMode: string | null;
  userName: string | null;
  userEmail: string | null;
}): boolean {
  return (
    c.entryMode === "qr" ||
    c.userName === "QR operator" ||
    (c.userEmail?.startsWith("qr:") ?? false)
  );
}

// `embedded` skips the page-level heading + description for use inside
// a section panel (the section header provides the title).
export function ConversationsList({
  source,
  embedded = false,
}: {
  source: ConversationsSource;
  embedded?: boolean;
}) {
  const t = useTranslations("admin.conversations");
  const tc = useTranslations("common");
  const tErr = useTranslations("admin.apiErrors");
  const [items, setItems] = useState<AdminConversationListItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] =
    useState<AdminConversationResolutionFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<AdminConversationSort>("problems");

  const sourceKey =
    source.kind === "machine" ? source.machineId : source.accountId;

  useEffect(() => {
    let cancelled = false;
    const query = {
      page,
      perPage: PER_PAGE,
      resolution,
      from: from || undefined,
      to: to || undefined,
      sort,
    };
    (source.kind === "machine"
      ? listAdminConversations(source.machineId, query)
      : listAdminFleetConversations(source.accountId, query)
    )
      .then((res) => {
        if (cancelled) return;
        setItems(res.conversations);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // sourceKey stands in for the source object (rebuilt every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind, sourceKey, page, resolution, from, to, sort]);

  const detailHref = (conversationId: string) =>
    source.kind === "machine"
      ? `/admin/machines/${source.machineId}/conversations/${conversationId}`
      : `/admin/accounts/${encodeURIComponent(source.accountId)}/conversations/${conversationId}`;

  const filtered = resolution !== "all" || from !== "" || to !== "";
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  const operatorName = (c: AdminConversationListItem) =>
    isQrConversation(c) ? t("qrOperator") : (c.userName ?? c.userEmail ?? "—");
  const operatorEmail = (c: AdminConversationListItem) =>
    !isQrConversation(c) && c.userName && c.userEmail ? c.userEmail : null;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      {embedded ? (
        <p className="text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
          {t("description")}
        </p>
      ) : (
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
            {t("heading")}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
            {t("description")}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 sm:gap-4">
        <div className="min-w-[150px]">
          <Select
            label={t("filterStatus")}
            value={resolution}
            onValueChange={(v) => {
              setResolution(v as AdminConversationResolutionFilter);
              setPage(0);
            }}
          >
            <option value="all">{t("filterAll")}</option>
            <option value="resolved">{t("resolutionResolved")}</option>
            <option value="unresolved">{t("resolutionUnresolved")}</option>
            <option value="escalated">{t("resolutionEscalated")}</option>
            <option value="none">{t("resolutionNone")}</option>
          </Select>
        </div>
        <div className="min-w-[150px]">
          <TextField
            label={t("filterFrom")}
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="min-w-[150px]">
          <TextField
            label={t("filterTo")}
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="min-w-[170px]">
          <Select
            label={t("sortLabel")}
            value={sort}
            onValueChange={(v) => {
              setSort(v as AdminConversationSort);
              setPage(0);
            }}
          >
            <option value="problems">{t("sortProblems")}</option>
            <option value="newest">{t("sortNewest")}</option>
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {filtered ? t("emptyFiltered") : t("empty")}
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="flex flex-col gap-2 sm:hidden">
            {items.map((c) => {
              const badge = resolutionBadge(c.resolution, t);
              return (
                <Link
                  key={c.id}
                  href={detailHref(c.id)}
                  className="flex items-start gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 transition-colors active:bg-[var(--color-muted)]/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[14px] font-medium text-[var(--color-foreground)]">
                        {operatorName(c)}
                      </p>
                      {badge && (
                        <Tag variant={badge.variant} size="small">
                          {badge.label}
                        </Tag>
                      )}
                    </div>
                    {operatorEmail(c) && (
                      <p className="truncate text-[12px] text-[var(--color-muted-foreground)]">
                        {operatorEmail(c)}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--color-muted-foreground)]">
                      <span className="tabular-nums">{DA_DT.format(new Date(c.startedAt))}</span>
                      <span>{t("colMessages")}: <span className="tabular-nums text-[var(--color-foreground)]">{c.messageCount}</span></span>
                    </div>
                  </div>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                </Link>
              );
            })}
          </div>

          <div className="hidden sm:block">
            <DataTable>
              <DataTableHead>
                <DataTableHeader>{t("colStarted")}</DataTableHeader>
                <DataTableHeader>{t("colOperator")}</DataTableHeader>
                <DataTableHeader align="right">{t("colMessages")}</DataTableHeader>
                <DataTableHeader>{t("colLastActivity")}</DataTableHeader>
                <DataTableHeader>{t("colStatus")}</DataTableHeader>
                <DataTableHeader className="w-10" />
              </DataTableHead>
              <DataTableBody>
                {items.map((c) => {
                  const badge = resolutionBadge(c.resolution, t);
                  return (
                    <DataTableRow
                      key={c.id}
                      href={detailHref(c.id)}
                    >
                      <DataTableCell className="tabular-nums">
                        {DA_DT.format(new Date(c.startedAt))}
                      </DataTableCell>
                      <DataTableCell className="group-hover:underline">
                        <div className="font-medium">{operatorName(c)}</div>
                        {operatorEmail(c) && (
                          <div className="text-[12px] text-[var(--ds-grey-medium-05)]">
                            {operatorEmail(c)}
                          </div>
                        )}
                      </DataTableCell>
                      <DataTableCell align="right" className="tabular-nums">
                        {c.messageCount}
                      </DataTableCell>
                      <DataTableCell className="tabular-nums text-[var(--ds-grey-medium-05)]">
                        {c.lastMessageAt
                          ? DA_DT.format(new Date(c.lastMessageAt))
                          : "—"}
                      </DataTableCell>
                      <DataTableCell>
                        {badge ? (
                          <Tag variant={badge.variant} size="small">
                            {badge.label}
                          </Tag>
                        ) : (
                          <span className="text-[12px] text-[var(--ds-grey-medium-05)]">
                            —
                          </span>
                        )}
                      </DataTableCell>
                      <DataTableCell align="right">
                        <ChevronRight className="ml-auto h-4 w-4 text-[var(--ds-grey-medium-05)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ds-grey-dark-09)]" />
                      </DataTableCell>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--color-muted-foreground)]">
            <span>{t("totalLabel", { count: total })}</span>
            {pageCount > 1 && (
              <Pagination
                page={page + 1}
                pageCount={pageCount}
                onChange={(p) => setPage(p - 1)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
