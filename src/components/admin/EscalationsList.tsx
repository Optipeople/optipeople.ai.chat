"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Wrench } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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
  listAdminEscalations,
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
  const router = useRouter();
  const t = useTranslations("admin.escalations");
  const tc = useTranslations("common");
  const CHANNEL_LABEL: Record<AdminEscalationListItem["channel"], string> = {
    sms: t("channelSms"),
    email: t("channelEmail"),
    service_ticket: t("channelServiceTicket"),
    webhook: t("channelWebhook"),
  };
  const [items, setItems] = useState<AdminEscalationListItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminEscalations(machineId, page, PER_PAGE)
      .then((res) => {
        if (cancelled) return;
        setItems(res.escalations);
        setHasMore(res.hasMore);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : tc("unknownError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId, page]);

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
                  <Tag variant={CHANNEL_VARIANT[e.channel]} size="small">
                    <Wrench className="mr-1 h-3 w-3" />
                    {CHANNEL_LABEL[e.channel]}
                  </Tag>
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--color-muted-foreground)]">
                  <span>{t("colOperator")}: {e.createdBy ?? "—"}</span>
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
                <DataTableHeader>{t("colTechnicianLink")}</DataTableHeader>
                <DataTableHeader className="w-10" />
              </DataTableHead>
              <DataTableBody>
                {items.map((e) => (
                  <DataTableRow
                    key={e.id}
                    onClick={() => {
                      router.push(
                        `/admin/machines/${machineId}/conversations/${e.conversationId}`,
                      );
                    }}
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
                      <span className="block max-w-[260px] truncate" title={e.target}>
                        {e.target}
                      </span>
                    </DataTableCell>
                    <DataTableCell>{e.createdBy ?? "—"}</DataTableCell>
                    <DataTableCell className="text-[13px] text-[var(--ds-grey-medium-05)]">
                      <span className="block max-w-[220px] truncate" title={e.note ?? undefined}>
                        {e.note ?? "—"}
                      </span>
                    </DataTableCell>
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

          {(page > 0 || hasMore) && (
            <div className="flex items-center justify-between text-[13px] text-[var(--color-muted-foreground)]">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                {t("prev")}
              </Button>
              <span>{t("pageLabel", { n: page + 1 })}</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("next")}
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
