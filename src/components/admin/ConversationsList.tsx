"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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

// `embedded` skips the page-level heading + description for use inside
// a section panel (the section header provides the title).
export function ConversationsList({
  machineId,
  embedded = false,
}: {
  machineId: string;
  embedded?: boolean;
}) {
  const router = useRouter();
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
            {items.map((c) => {
              const badge = resolutionBadge(c.resolution, t);
              return (
                <Link
                  key={c.id}
                  href={`/admin/machines/${machineId}/conversations/${c.id}`}
                  className="flex items-start gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 transition-colors active:bg-[var(--color-muted)]/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[14px] font-medium text-[var(--color-foreground)]">
                        {c.userName ?? c.userEmail ?? "—"}
                      </p>
                      {badge && (
                        <Tag variant={badge.variant} size="small">
                          {badge.label}
                        </Tag>
                      )}
                    </div>
                    {c.userName && c.userEmail && (
                      <p className="truncate text-[12px] text-[var(--color-muted-foreground)]">
                        {c.userEmail}
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
                      onClick={() => {
                        router.push(
                          `/admin/machines/${machineId}/conversations/${c.id}`,
                        );
                      }}
                    >
                      <DataTableCell className="tabular-nums">
                        {DA_DT.format(new Date(c.startedAt))}
                      </DataTableCell>
                      <DataTableCell className="group-hover:underline">
                        <div className="font-medium">
                          {c.userName ?? c.userEmail ?? "—"}
                        </div>
                        {c.userName && c.userEmail && (
                          <div className="text-[12px] text-[var(--ds-grey-medium-05)]">
                            {c.userEmail}
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
