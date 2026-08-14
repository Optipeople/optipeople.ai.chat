"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, Wrench } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
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
  listAdminEscalations,
  setAdminEscalationStatus,
  type AdminEscalationListItem,
} from "@/admin/adminApi";

const DA_DT = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "short",
  timeStyle: "short",
});

const PER_PAGE = 25;

const CHANNEL_VARIANT: Record<AdminEscalationListItem["channel"], TagVariant> = {
  sms: "default",
  email: "default",
  service_ticket: "warning",
  webhook: "positive",
};

// `embedded` skips the page-level heading + description for use inside
// a section panel (the section header provides the title).
export function EscalationsList({
  machineId,
  embedded = false,
}: {
  machineId: string;
  embedded?: boolean;
}) {
  const t = useTranslations("admin.escalations");
  const tc = useTranslations("common");
  const tErr = useTranslations("admin.apiErrors");
  const CHANNEL_LABEL: Record<AdminEscalationListItem["channel"], string> = {
    sms: t("channelSms"),
    email: t("channelEmail"),
    service_ticket: t("channelServiceTicket"),
    webhook: t("channelWebhook"),
  };
  const [items, setItems] = useState<AdminEscalationListItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminEscalations(machineId, page, PER_PAGE)
      .then((res) => {
        if (cancelled) return;
        setItems(res.escalations);
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
  }, [machineId, page]);

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  // Escalations from QR-sticker sessions store the pseudo user id
  // ("qr:<suffix>") as created_by — show a readable label instead.
  const operatorLabel = (createdBy: string | null) =>
    createdBy == null ? "—" : createdBy.startsWith("qr:") ? t("qrOperator") : createdBy;

  // Optimistic toggle: flip the row immediately, revert if the PATCH
  // fails.
  async function toggleStatus(e: AdminEscalationListItem) {
    const next = e.status === "open" ? "handled" : "open";
    setActionError(null);
    setItems((prev) =>
      prev.map((x) => (x.id === e.id ? { ...x, status: next } : x)),
    );
    try {
      const updated = await setAdminEscalationStatus(e.id, next);
      setItems((prev) =>
        prev.map((x) =>
          x.id === e.id
            ? {
                ...x,
                status: updated.status,
                handledAt: updated.handledAt,
                handledBy: updated.handledBy,
              }
            : x,
        ),
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((x) => (x.id === e.id ? { ...x, status: e.status } : x)),
      );
      setActionError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
    }
  }

  function statusCell(e: AdminEscalationListItem) {
    return (
      <div className="flex items-center gap-2">
        <Tag variant={e.status === "open" ? "warning" : "positive"} size="small">
          {e.status === "open" ? t("statusOpen") : t("statusHandled")}
        </Tag>
        <Button
          variant="ghost"
          size="pill"
          title={
            e.status === "handled" && e.handledBy
              ? t("handledByTitle", { by: e.handledBy })
              : undefined
          }
          onClick={(ev) => {
            ev.stopPropagation();
            void toggleStatus(e);
          }}
        >
          {e.status === "open" ? t("markHandled") : t("reopen")}
        </Button>
      </div>
    );
  }

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

      {actionError && (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-3 text-[13px] text-[var(--ds-red-dark)]">
          {actionError}
        </div>
      )}

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
          {t("empty")}
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="flex flex-col gap-2 sm:hidden">
            {items.map((e) => (
              <Link
                key={e.id}
                href={`/admin/machines/${machineId}/conversations/${e.conversationId}`}
                className="flex flex-col gap-2 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 transition-colors active:bg-[var(--color-muted)]/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag variant={CHANNEL_VARIANT[e.channel]} size="small">
                      <Wrench className="mr-1 h-3 w-3" />
                      {CHANNEL_LABEL[e.channel]}
                    </Tag>
                    <Tag
                      variant={e.status === "open" ? "warning" : "positive"}
                      size="small"
                    >
                      {e.status === "open" ? t("statusOpen") : t("statusHandled")}
                    </Tag>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-muted-foreground)]">
                    {DA_DT.format(new Date(e.createdAt))}
                  </span>
                </div>
                <p className="break-all font-mono text-[12px] text-[var(--color-foreground)]">
                  {e.target}
                </p>
                {e.note && (
                  <p className="break-words text-[13px] text-[var(--color-muted-foreground)]">
                    {e.note}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--color-muted-foreground)]">
                  <span>{t("colOperator")}: {operatorLabel(e.createdBy)}</span>
                  {e.shareToken && (
                    <a
                      href={`/escalation/${e.shareToken}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(ev) => ev.stopPropagation()}
                      className="inline-flex items-center gap-1 text-amber-800 underline"
                    >
                      {t("open")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="pill"
                    className="ml-auto"
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      void toggleStatus(e);
                    }}
                  >
                    {e.status === "open" ? t("markHandled") : t("reopen")}
                  </Button>
                </div>
              </Link>
            ))}
          </div>

          <div className="hidden sm:block">
            <DataTable>
              <DataTableHead>
                <DataTableHeader>{t("colTime")}</DataTableHeader>
                <DataTableHeader>{t("colChannel")}</DataTableHeader>
                <DataTableHeader>{t("colRecipient")}</DataTableHeader>
                <DataTableHeader>{t("colOperator")}</DataTableHeader>
                <DataTableHeader>{t("colDescription")}</DataTableHeader>
                <DataTableHeader>{t("colStatus")}</DataTableHeader>
                <DataTableHeader>{t("colTechnicianLink")}</DataTableHeader>
                <DataTableHeader className="w-10" />
              </DataTableHead>
              <DataTableBody>
                {items.map((e) => (
                  <DataTableRow
                    key={e.id}
                    href={`/admin/machines/${machineId}/conversations/${e.conversationId}`}
                  >
                    <DataTableCell className="tabular-nums">
                      {DA_DT.format(new Date(e.createdAt))}
                    </DataTableCell>
                    <DataTableCell>
                      <Tag variant={CHANNEL_VARIANT[e.channel]} size="small">
                        <Wrench className="mr-1 h-3 w-3" />
                        {CHANNEL_LABEL[e.channel]}
                      </Tag>
                    </DataTableCell>
                    <DataTableCell className="font-mono text-[12px]">
                      <span className="block max-w-[220px] truncate" title={e.target}>
                        {e.target}
                      </span>
                    </DataTableCell>
                    <DataTableCell>{operatorLabel(e.createdBy)}</DataTableCell>
                    <DataTableCell className="text-[13px] text-[var(--ds-grey-medium-05)]">
                      <span className="block max-w-[180px] truncate" title={e.note ?? undefined}>
                        {e.note ?? "—"}
                      </span>
                    </DataTableCell>
                    <DataTableCell>{statusCell(e)}</DataTableCell>
                    <DataTableCell>
                      {e.shareToken ? (
                        <a
                          href={`/escalation/${e.shareToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(ev) => ev.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[13px] text-amber-800 underline hover:text-amber-900"
                        >
                          {t("open")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
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
                ))}
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
