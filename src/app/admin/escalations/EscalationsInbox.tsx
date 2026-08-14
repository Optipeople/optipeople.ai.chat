"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
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
  listAdminEscalationInbox,
  setAdminEscalationStatus,
  type AdminEscalationInboxItem,
  type AdminEscalationStatusFilter,
} from "@/admin/adminApi";

const DA_DT = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "short",
  timeStyle: "short",
});

const PER_PAGE = 25;

const CHANNEL_VARIANT: Record<AdminEscalationInboxItem["channel"], TagVariant> = {
  sms: "default",
  email: "default",
  service_ticket: "warning",
  webhook: "positive",
};

// Cross-machine escalation inbox at /admin/escalations. Server scopes
// account admins to their own account; super admins/partners see all.
export function EscalationsInbox() {
  const t = useTranslations("admin.escalationsInbox");
  const te = useTranslations("admin.escalations");
  const tc = useTranslations("common");
  const tErr = useTranslations("admin.apiErrors");
  const CHANNEL_LABEL: Record<AdminEscalationInboxItem["channel"], string> = {
    sms: te("channelSms"),
    email: te("channelEmail"),
    service_ticket: te("channelServiceTicket"),
    webhook: te("channelWebhook"),
  };
  const [items, setItems] = useState<AdminEscalationInboxItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<AdminEscalationStatusFilter>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminEscalationInbox({ page, perPage: PER_PAGE, status })
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
  }, [page, status]);

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  const operatorLabel = (createdBy: string | null) =>
    createdBy == null ? "—" : createdBy.startsWith("qr:") ? te("qrOperator") : createdBy;

  // Optimistic toggle: flip the row immediately, revert if the PATCH
  // fails. When the status filter hides the row's new state, the row is
  // dropped from the visible list on success.
  async function toggleStatus(e: AdminEscalationInboxItem) {
    const next = e.status === "open" ? "handled" : "open";
    setActionError(null);
    setItems((prev) =>
      prev.map((x) => (x.id === e.id ? { ...x, status: next } : x)),
    );
    try {
      const updated = await setAdminEscalationStatus(e.id, next);
      setItems((prev) =>
        status !== "all"
          ? prev.filter((x) => x.id !== e.id)
          : prev.map((x) =>
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
      if (status !== "all") setTotal((n) => Math.max(0, n - 1));
    } catch (err) {
      setItems((prev) =>
        prev.map((x) => (x.id === e.id ? { ...x, status: e.status } : x)),
      );
      setActionError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
    }
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
          {t("heading")}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
          {t("description")}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 sm:gap-4">
        <div className="min-w-[160px]">
          <Select
            label={t("filterStatus")}
            value={status}
            onValueChange={(v) => {
              setStatus(v as AdminEscalationStatusFilter);
              setPage(0);
            }}
          >
            <option value="open">{t("filterOpen")}</option>
            <option value="handled">{t("filterHandled")}</option>
            <option value="all">{t("filterAll")}</option>
          </Select>
        </div>
      </div>

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
                href={`/admin/machines/${encodeURIComponent(e.machineId)}?section=escalations`}
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
                      {e.status === "open" ? te("statusOpen") : te("statusHandled")}
                    </Tag>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-[var(--color-muted-foreground)]">
                    {DA_DT.format(new Date(e.createdAt))}
                  </span>
                </div>
                <p className="truncate text-[14px] font-medium text-[var(--color-foreground)]">
                  {e.machineName ?? e.machineId}
                </p>
                {e.note && (
                  <p className="break-words text-[13px] text-[var(--color-muted-foreground)]">
                    {e.note}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--color-muted-foreground)]">
                  <span>{t("colOperator")}: {operatorLabel(e.createdBy)}</span>
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
                    {e.status === "open" ? te("markHandled") : te("reopen")}
                  </Button>
                </div>
              </Link>
            ))}
          </div>

          <div className="hidden sm:block">
            <DataTable>
              <DataTableHead>
                <DataTableHeader>{t("colCreated")}</DataTableHeader>
                <DataTableHeader>{t("colMachine")}</DataTableHeader>
                <DataTableHeader>{t("colAccount")}</DataTableHeader>
                <DataTableHeader>{t("colChannel")}</DataTableHeader>
                <DataTableHeader>{t("colStatus")}</DataTableHeader>
                <DataTableHeader>{t("colOperator")}</DataTableHeader>
                <DataTableHeader>{t("colNote")}</DataTableHeader>
                <DataTableHeader className="w-10" />
              </DataTableHead>
              <DataTableBody>
                {items.map((e) => (
                  <DataTableRow
                    key={e.id}
                    href={`/admin/machines/${encodeURIComponent(e.machineId)}?section=escalations`}
                  >
                    <DataTableCell className="tabular-nums">
                      {DA_DT.format(new Date(e.createdAt))}
                    </DataTableCell>
                    <DataTableCell>
                      <Link
                        href={`/admin/machines/${encodeURIComponent(e.machineId)}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="font-medium hover:underline"
                      >
                        {e.machineName ?? e.machineId}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-[13px] text-[var(--ds-grey-medium-05)]">
                      <span className="block max-w-[140px] truncate" title={e.accountId}>
                        {e.accountId}
                      </span>
                    </DataTableCell>
                    <DataTableCell>
                      <Tag variant={CHANNEL_VARIANT[e.channel]} size="small">
                        <Wrench className="mr-1 h-3 w-3" />
                        {CHANNEL_LABEL[e.channel]}
                      </Tag>
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex items-center gap-2">
                        <Tag
                          variant={e.status === "open" ? "warning" : "positive"}
                          size="small"
                        >
                          {e.status === "open" ? te("statusOpen") : te("statusHandled")}
                        </Tag>
                        <Button
                          variant="ghost"
                          size="pill"
                          title={
                            e.status === "handled" && e.handledBy
                              ? te("handledByTitle", { by: e.handledBy })
                              : undefined
                          }
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void toggleStatus(e);
                          }}
                        >
                          {e.status === "open" ? te("markHandled") : te("reopen")}
                        </Button>
                      </div>
                    </DataTableCell>
                    <DataTableCell>{operatorLabel(e.createdBy)}</DataTableCell>
                    <DataTableCell className="text-[13px] text-[var(--ds-grey-medium-05)]">
                      <span className="block max-w-[200px] truncate" title={e.note ?? undefined}>
                        {e.note ?? "—"}
                      </span>
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
            <span>{te("totalLabel", { count: total })}</span>
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
