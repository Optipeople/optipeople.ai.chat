"use client";

import { useEffect, useMemo, useState } from "react";
import { Folder, Loader2, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  applyAutoOrganize,
  previewAutoOrganize,
  type AutoOrganizeProposal,
  type StandardFolder,
} from "@/admin/adminApi";

// Modal that runs an auto-organise preview, lets the operator opt in/out
// per proposed move, and applies the confirmed subset. We bake the
// preview load into the dialog itself so the trigger button can stay a
// dumb "click → open" — no parent-side fetch state to thread through.

type Phase = "loading" | "ready" | "applying" | "error";

export function AutoOrganizeDialog({
  machineId,
  onClose,
  onApplied,
}: {
  machineId: string;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const t = useTranslations("admin.autoOrganize");
  const tc = useTranslations("common");
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<AutoOrganizeProposal[]>([]);
  const [folders, setFolders] = useState<StandardFolder[]>([]);
  // ids of moves the operator has *opted out of*. Default state is "all
  // suggested moves checked", so we track the negative space — fewer
  // surprises when the proposal set updates.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    previewAutoOrganize(machineId)
      .then((res) => {
        if (cancelled) return;
        setProposals(res.proposals);
        setFolders(res.folders);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : tc("unknownError"));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [machineId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "applying") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  // A "move" is a proposal where the proposed folder differs from the
  // current folder. Same-folder proposals are no-ops and shown only in
  // the "Beholdes uændret" tail for context.
  const { moves, unchanged } = useMemo(() => {
    const moves: AutoOrganizeProposal[] = [];
    const unchanged: AutoOrganizeProposal[] = [];
    for (const p of proposals) {
      if (
        p.proposedFolder !== null &&
        p.proposedFolder !== (p.currentFolder ?? null)
      ) {
        moves.push(p);
      } else {
        unchanged.push(p);
      }
    }
    return { moves, unchanged };
  }, [proposals]);

  const byFolder = useMemo(() => {
    const map = new Map<string, AutoOrganizeProposal[]>();
    for (const f of folders) map.set(f.path, []);
    for (const m of moves) {
      if (!m.proposedFolder) continue;
      const list = map.get(m.proposedFolder);
      if (list) list.push(m);
      else map.set(m.proposedFolder, [m]);
    }
    return map;
  }, [folders, moves]);

  const selectedCount = moves.length - excluded.size;

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFolder(folder: string, checked: boolean) {
    const ids = byFolder.get(folder)?.map((p) => p.id) ?? [];
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function apply() {
    if (selectedCount === 0) {
      onClose();
      return;
    }
    setPhase("applying");
    setError(null);
    try {
      const payload = moves
        .filter((m) => !excluded.has(m.id) && m.proposedFolder !== null)
        .map((m) => ({ id: m.id, folder: m.proposedFolder! }));
      await applyAutoOrganize(machineId, payload);
      await onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc("unknownError"));
      setPhase("ready");
    }
  }

  const busy = phase === "applying";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auto-organize-title"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 py-8 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] px-6 py-5">
          <div>
            <h2
              id="auto-organize-title"
              className="flex items-center gap-2 text-[18px] font-semibold tracking-tight text-[var(--color-foreground)]"
            >
              <Sparkles className="h-4 w-4 text-[var(--color-brand)]" />
              {t("heading")}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
              {t("description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label={t("closeAria")}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-[14px] text-[var(--color-muted-foreground)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("analyzing")}
            </div>
          )}

          {phase === "error" && (
            <div className="rounded-[4px] border border-[var(--ds-red)]/30 bg-[var(--ds-red-bg)] px-3 py-3 text-[13px] text-[var(--ds-red)]">
              {error}
            </div>
          )}

          {phase !== "loading" && phase !== "error" && moves.length === 0 && (
            <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-background)] px-4 py-6 text-center text-[14px] text-[var(--color-muted-foreground)]">
              {proposals.length === 0 ? t("noReadyDocs") : t("allInPlace")}
            </div>
          )}

          {phase !== "loading" && phase !== "error" && moves.length > 0 && (
            <div className="flex flex-col gap-5">
              {folders
                .filter((f) => (byFolder.get(f.path)?.length ?? 0) > 0)
                .map((f) => {
                  const items = byFolder.get(f.path) ?? [];
                  const checkedCount = items.filter(
                    (i) => !excluded.has(i.id),
                  ).length;
                  const allChecked = checkedCount === items.length;
                  const noneChecked = checkedCount === 0;
                  return (
                    <section key={f.path}>
                      <header className="mb-2 flex items-center gap-2">
                        <Checkbox
                          checked={allChecked}
                          indeterminate={!allChecked && !noneChecked}
                          onChange={(e) =>
                            toggleFolder(f.path, e.target.checked)
                          }
                          disabled={busy}
                        />
                        <Folder className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                        <span className="text-[14px] font-semibold text-[var(--color-foreground)]">
                          {f.path}
                        </span>
                        <span className="text-[12px] text-[var(--color-muted-foreground)]">
                          {t("folderItemCount", { checked: checkedCount, total: items.length })}
                        </span>
                      </header>
                      <ul className="flex flex-col divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[4px] border border-[var(--color-hairline)]">
                        {items.map((p) => {
                          const checked = !excluded.has(p.id);
                          return (
                            <li
                              key={p.id}
                              className={cn(
                                "flex items-start gap-3 px-3 py-2 text-[13px]",
                                checked
                                  ? "bg-[var(--color-surface)]"
                                  : "bg-[var(--color-background)] opacity-60",
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onChange={() => toggle(p.id)}
                                disabled={busy}
                                className="mt-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-[var(--color-foreground)]">
                                  {p.title}
                                </div>
                                <div className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
                                  {p.currentFolder
                                    ? t("fromFolder", { folder: p.currentFolder })
                                    : t("fromRoot")}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}

              {unchanged.length > 0 && (
                <section>
                  <header className="mb-2 flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--color-muted-foreground)]">
                      {t("unchangedHeader", { n: unchanged.length })}
                    </span>
                  </header>
                  <ul className="flex flex-col divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[4px] border border-[var(--color-hairline)] opacity-70">
                    {unchanged.slice(0, 20).map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px] text-[var(--color-muted-foreground)]"
                      >
                        <span className="truncate">{p.title}</span>
                        <span className="shrink-0">
                          {p.currentFolder ?? t("rootLabel")}
                        </span>
                      </li>
                    ))}
                    {unchanged.length > 20 && (
                      <li className="px-3 py-1.5 text-center text-[12px] text-[var(--color-muted-foreground)]">
                        {t("moreItems", { n: unchanged.length - 20 })}
                      </li>
                    )}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-hairline)] px-6 py-4">
          <span className="text-[13px] text-[var(--color-muted-foreground)]">
            {moves.length > 0 && phase !== "loading"
              ? selectedCount === 1
                ? t("moveSelected", { count: selectedCount })
                : t("movesSelected", { count: selectedCount })
              : " "}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => !busy && onClose()}
              disabled={busy}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => void apply()}
              disabled={busy || phase !== "ready" || selectedCount === 0}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              {selectedCount > 0 && phase === "ready"
                ? t("applyWithCount", { count: selectedCount })
                : t("apply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
