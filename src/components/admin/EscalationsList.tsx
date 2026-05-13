"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, Loader2, Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tag, type TagVariant } from "@/components/ui/tag";
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

export function EscalationsList({ machineId }: { machineId: string }) {
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
      <Link
        href={`/admin/machines/${machineId}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("back")}
      </Link>

      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
          {t("heading")}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
          {t("description")}
        </p>
      </div>

      {error ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
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

          <div className="hidden overflow-hidden rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] sm:block">
            <table className="w-full text-[14px]">
              <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("colTime")}</th>
                  <th className="px-4 py-3 font-medium">{t("colChannel")}</th>
                  <th className="px-4 py-3 font-medium">{t("colRecipient")}</th>
                  <th className="px-4 py-3 font-medium">{t("colOperator")}</th>
                  <th className="px-4 py-3 font-medium">{t("colDescription")}</th>
                  <th className="px-4 py-3 font-medium">{t("colTechnicianLink")}</th>
                  <th className="w-10 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr
                    key={e.id}
                    className="group cursor-pointer border-t border-[var(--color-hairline)] transition-colors hover:bg-[var(--color-muted)]/60"
                    onClick={() => {
                      window.location.href = `/admin/machines/${machineId}/conversations/${e.conversationId}`;
                    }}
                  >
                    <td className="px-4 py-3 tabular-nums text-[var(--color-foreground)]">
                      {DA_DT.format(new Date(e.createdAt))}
                    </td>
                    <td className="px-4 py-3">
                      <Tag variant={CHANNEL_VARIANT[e.channel]} size="small">
                        <Wrench className="mr-1 h-3 w-3" />
                        {CHANNEL_LABEL[e.channel]}
                      </Tag>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-foreground)]">
                      <span className="block max-w-[260px] truncate" title={e.target}>
                        {e.target}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-foreground)]">
                      {e.createdBy ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-muted-foreground)]">
                      <span className="block max-w-[220px] truncate" title={e.note ?? undefined}>
                        {e.note ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
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
                        <span className="text-[12px] text-[var(--color-muted-foreground)]">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-[var(--color-muted-foreground)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-foreground)]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(page > 0 || hasMore) && (
            <div className="flex items-center justify-between text-[13px] text-[var(--color-muted-foreground)]">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
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
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
