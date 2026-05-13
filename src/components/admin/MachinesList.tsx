"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, MessageSquare, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { getAdminMachines, type AdminMachine } from "@/admin/adminApi";
import { AddMachineDialog } from "@/components/admin/AddMachineDialog";

export function MachinesList() {
  const router = useRouter();
  const t = useTranslations("admin.machinesList");
  const tc = useTranslations("common");
  const [machines, setMachines] = useState<AdminMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const reload = useCallback(async () => {
    const rows = await getAdminMachines();
    setMachines(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAdminMachines()
      .then((rows) => {
        if (cancelled) return;
        setMachines(rows);
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
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter((m) => {
      const name = (m.displayName ?? "").toLowerCase();
      return name.includes(q) || m.machineId.toLowerCase().includes(q);
    });
  }, [machines, query]);

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
            {t("heading")}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
            {loading
              ? t("loading")
              : t("countLabel", { count: machines.length })}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery("")}
            placeholder={t("searchPlaceholder")}
            className="w-full sm:w-72"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="self-start sm:self-auto"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("addMachine")}
          </Button>
        </div>
      </div>

      {addOpen && (
        <AddMachineDialog
          existingMachineIds={new Set(machines.map((m) => m.machineId))}
          onClose={() => setAddOpen(false)}
          onCreated={reload}
        />
      )}

      {error ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-6 text-[14px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {machines.length === 0 ? t("emptyFirst") : t("emptySearch")}
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="flex flex-col gap-2 sm:hidden">
            {filtered.map((m) => (
              <div
                key={m.machineId}
                onClick={() => router.push(`/admin/machines/${m.machineId}`)}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3",
                  "transition-colors active:bg-[var(--color-muted)]/60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-[var(--color-foreground)]">
                    {m.displayName ?? t("noName")}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-muted-foreground)]">
                    {m.machineId}
                  </p>
                  <p className="mt-1.5 text-[12px] text-[var(--color-muted-foreground)]">
                    {t("colDocuments")}:{" "}
                    <span className="tabular-nums text-[var(--color-foreground)]">
                      {m.documentCount}
                    </span>
                  </p>
                </div>
                <a
                  href={`/?account=${encodeURIComponent(m.accountId)}&machine=${encodeURIComponent(m.machineId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={t("openChatTitle")}
                  aria-label={t("openChatAria")}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                >
                  <MessageSquare className="h-4 w-4" />
                </a>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] sm:block">
            <table className="w-full text-[14px]">
              <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("colName")}</th>
                  <th className="px-4 py-3 font-medium">{t("colMachineId")}</th>
                  <th className="px-4 py-3 font-medium">{t("colAccountId")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("colDocuments")}</th>
                  <th className="w-10 px-4 py-3"></th>
                  <th className="w-10 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr
                    key={m.machineId}
                    onClick={() => router.push(`/admin/machines/${m.machineId}`)}
                    className={cn(
                      "group cursor-pointer border-t border-[var(--color-hairline)]",
                      "transition-colors hover:bg-[var(--color-muted)]/60",
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-foreground)] group-hover:underline">
                      {m.displayName ?? t("noName")}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-muted-foreground)]">
                      {m.machineId}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-muted-foreground)]">
                      {m.accountId}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--color-foreground)]">
                      {m.documentCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/?account=${encodeURIComponent(m.accountId)}&machine=${encodeURIComponent(m.machineId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={t("openChatTitle")}
                        aria-label={t("openChatAria")}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-[var(--color-muted-foreground)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--color-foreground)]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
