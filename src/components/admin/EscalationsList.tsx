"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, ExternalLink, Loader2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listAdminEscalations,
  type AdminEscalationListItem,
} from "@/admin/adminApi";

const DA_DT = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "short",
  timeStyle: "short",
});

const PER_PAGE = 25;

const CHANNEL_LABEL: Record<AdminEscalationListItem["channel"], string> = {
  phone: "Telefon",
  email: "E-mail",
  service_ticket: "Service-ticket",
  webhook: "Webhook",
};

const CHANNEL_TONE: Record<AdminEscalationListItem["channel"], string> = {
  phone: "bg-sky-100 text-sky-800",
  email: "bg-violet-100 text-violet-800",
  service_ticket: "bg-amber-100 text-amber-800",
  webhook: "bg-emerald-100 text-emerald-800",
};

export function EscalationsList({ machineId }: { machineId: string }) {
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
          Eskaleringer
        </h1>
        <p className="mt-1 text-[14px] text-[var(--color-muted-foreground)]">
          Audit af alle service-tilkald for denne maskine. Klik på en
          række for at se den fulde samtale, eller åbn tekniker-linket
          for at se det samme som modtageren.
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
          Ingen eskaleringer endnu for denne maskine.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
            <table className="w-full text-[14px]">
              <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Tidspunkt</th>
                  <th className="px-4 py-3 font-medium">Kanal</th>
                  <th className="px-4 py-3 font-medium">Modtager</th>
                  <th className="px-4 py-3 font-medium">Operatør</th>
                  <th className="px-4 py-3 font-medium">Beskrivelse</th>
                  <th className="px-4 py-3 font-medium">Tekniker-link</th>
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
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          CHANNEL_TONE[e.channel],
                        )}
                      >
                        <Wrench className="h-3 w-3" />
                        {CHANNEL_LABEL[e.channel]}
                      </span>
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
                          Åbn
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
