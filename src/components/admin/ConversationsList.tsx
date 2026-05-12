"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tag, type TagVariant } from "@/components/ui/tag";
import {
  listAdminConversations,
  type AdminConversationListItem,
} from "@/admin/adminApi";

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

export function ConversationsList({ machineId }: { machineId: string }) {
  const t = useTranslations("admin.conversations");
  const tc = useTranslations("common");
  const [items, setItems] = useState<AdminConversationListItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminConversations(machineId, page, PER_PAGE)
      .then((res) => {
        if (cancelled) return;
        setItems(res.conversations);
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
    <div className="flex flex-col gap-6">
      <Link
        href={`/admin/machines/${machineId}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("back")}
      </Link>

      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[var(--color-foreground)]">
          {t("heading")}
        </h1>
        <p className="mt-1 text-[14px] text-[var(--color-muted-foreground)]">
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
          <div className="overflow-hidden rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            <table className="w-full text-[14px]">
              <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("colStarted")}</th>
                  <th className="px-4 py-3 font-medium">{t("colOperator")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("colMessages")}</th>
                  <th className="px-4 py-3 font-medium">{t("colLastActivity")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                  <th className="w-10 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const badge = resolutionBadge(c.resolution, t);
                  return (
                    <tr
                      key={c.id}
                      className="group cursor-pointer border-t border-[var(--color-hairline)] transition-colors hover:bg-[var(--color-muted)]/60"
                      onClick={() => {
                        window.location.href = `/admin/machines/${machineId}/conversations/${c.id}`;
                      }}
                    >
                      <td className="px-4 py-3 tabular-nums text-[var(--color-foreground)]">
                        {DA_DT.format(new Date(c.startedAt))}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-foreground)]">
                        <div className="font-medium">
                          {c.userName ?? c.userEmail ?? "—"}
                        </div>
                        {c.userName && c.userEmail && (
                          <div className="text-[12px] text-[var(--color-muted-foreground)]">
                            {c.userEmail}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-foreground)]">
                        {c.messageCount}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[var(--color-muted-foreground)]">
                        {c.lastMessageAt
                          ? DA_DT.format(new Date(c.lastMessageAt))
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {badge ? (
                          <Tag variant={badge.variant} size="small">
                            {badge.label}
                          </Tag>
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
                  );
                })}
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
