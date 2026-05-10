"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
): { label: string; tone: string } | null {
  switch (resolution) {
    case "resolved":
      return { label: "Løst", tone: "bg-emerald-100 text-emerald-700" };
    case "unresolved":
      return { label: "Uløst", tone: "bg-red-100 text-red-700" };
    case "escalated":
      return { label: "Eskaleret", tone: "bg-amber-100 text-amber-800" };
    case "unknown":
      return { label: "Ukendt", tone: "bg-slate-100 text-slate-700" };
    default:
      return null;
  }
}

export function ConversationsList({ machineId }: { machineId: string }) {
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
        setError(err instanceof Error ? err.message : "Ukendt fejl");
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
        Tilbage til maskine
      </Link>

      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[var(--color-foreground)]">
          Samtaler
        </h1>
        <p className="mt-1 text-[14px] text-[var(--color-muted-foreground)]">
          Audit af alle operatør-chats for denne maskine. Klik på en række
          for at se hele forløbet og hvilke manualer AI&#39;en konsulterede.
        </p>
      </div>

      {error ? (
        <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[14px] text-red-600">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          Ingen samtaler endnu for denne maskine.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            <table className="w-full text-[14px]">
              <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Startet</th>
                  <th className="px-4 py-3 font-medium">Operatør</th>
                  <th className="px-4 py-3 text-right font-medium">Beskeder</th>
                  <th className="px-4 py-3 font-medium">Sidste aktivitet</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="w-10 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const badge = resolutionBadge(c.resolution);
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
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                              badge.tone,
                            )}
                          >
                            {badge.label}
                          </span>
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
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] hover:bg-[var(--color-muted)] disabled:opacity-40"
              >
                ← Forrige
              </button>
              <span>Side {page + 1}</span>
              <button
                type="button"
                disabled={!hasMore}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-1.5 text-[13px] hover:bg-[var(--color-muted)] disabled:opacity-40"
              >
                Næste →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
