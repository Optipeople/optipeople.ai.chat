"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  ExternalLink,
  FileText,
  Folder,
  Image as ImageIcon,
  Loader2,
  X,
} from "lucide-react";
import { fetchWithAuth } from "@/auth/authApi";
import { getQrToken } from "@/auth/qrStorage";
import { useFileViewer } from "@/components/FileViewer";
import { cn } from "@/lib/utils";
import type {
  OperatorDocument,
  OperatorDocumentsResponse,
} from "@/app/api/machines/[id]/documents/route";

// Right-edge handle + slide-out overlay listing the operator-visible
// documents for the current machine. The list is grouped by folder; each
// row opens the original PDF / image in a new tab via the existing
// /api/documents/[id]/url endpoint, which respects both bearer and QR
// auth modes.
export function KnowledgeDrawer({ machineId }: { machineId: string }) {
  const t = useTranslations("knowledgeDrawer");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<OperatorDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qrToken = getQrToken();
      const url = qrToken
        ? `/api/machines/${encodeURIComponent(machineId)}/documents?qrToken=${encodeURIComponent(qrToken)}`
        : `/api/machines/${encodeURIComponent(machineId)}/documents`;
      const res = await fetchWithAuth(url);
      if (!res.ok) {
        throw new Error(`Server error ${res.status}`);
      }
      const body = (await res.json()) as OperatorDocumentsResponse;
      setDocs(body.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  // Lazy: only fetch when the drawer is first opened, and refetch on
  // each reopen so newly-promoted documents show up without a page
  // reload.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("openAria")}
        title={t("openTitle")}
        className={cn(
          "fixed right-0 top-1/2 z-20 -translate-y-1/2",
          "flex h-20 w-7 items-center justify-center rounded-l-[6px]",
          "border border-r-0 border-[var(--color-hairline)] bg-[var(--color-surface)]",
          "text-[var(--color-muted-foreground)] shadow-[var(--shadow-sm)]",
          "transition-all hover:w-8 hover:text-[var(--color-foreground)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        )}
      >
        <BookOpen className="h-4 w-4" />
      </button>

      {open && (
        <DrawerOverlay
          onClose={() => setOpen(false)}
          loading={loading}
          docs={docs}
          error={error}
          onRetry={() => void load()}
        />
      )}
    </>
  );
}

function DrawerOverlay({
  onClose,
  loading,
  docs,
  error,
  onRetry,
}: {
  onClose: () => void;
  loading: boolean;
  docs: OperatorDocument[] | null;
  error: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations("knowledgeDrawer");
  return (
    <div className="fixed inset-0 z-30">
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={t("drawerAria")}
        className={cn(
          "absolute right-0 top-0 flex h-full w-full max-w-md flex-col",
          "border-l border-[var(--color-hairline)] bg-[var(--color-background)]",
          "shadow-[var(--shadow-md)]",
          "drawer-in",
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-5 w-5 shrink-0 text-[var(--color-foreground)]" />
            <h2 className="truncate text-[16px] font-semibold tracking-tight text-[var(--color-foreground)]">
              {t("heading")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeAria")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <p className="px-4 pt-3 text-[13px] text-[var(--color-muted-foreground)] sm:px-5">
          {t("description")}
        </p>
        <div className="flex-1 overflow-y-auto px-2 py-3">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
            </div>
          )}
          {!loading && error && (
            <div className="mx-3 rounded-[4px] border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
              <p>{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 text-[13px] font-medium text-red-700 underline hover:text-red-800"
              >
                {t("retry")}
              </button>
            </div>
          )}
          {!loading && !error && docs && docs.length === 0 && (
            <div className="px-3 py-8 text-center text-[14px] text-[var(--color-muted-foreground)]">
              {t("empty")}
            </div>
          )}
          {!loading && !error && docs && docs.length > 0 && (
            <DocumentTree docs={docs} />
          )}
        </div>
      </aside>
    </div>
  );
}

function DocumentTree({ docs }: { docs: OperatorDocument[] }) {
  const groups = useMemo(() => groupByFolder(docs), [docs]);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.folder ?? "__root__"} className="flex flex-col">
          {g.folder && (
            <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              <Folder className="h-3.5 w-3.5" />
              <span>{g.folder}</span>
            </div>
          )}
          <ul className="flex flex-col">
            {g.docs.map((d) => (
              <li key={d.id}>
                <DocumentLink doc={d} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupByFolder(docs: OperatorDocument[]): {
  folder: string | null;
  docs: OperatorDocument[];
}[] {
  const map = new Map<string, OperatorDocument[]>();
  for (const d of docs) {
    const key = d.folderPath ?? "__root__";
    const arr = map.get(key);
    if (arr) arr.push(d);
    else map.set(key, [d]);
  }
  const root = map.get("__root__") ?? [];
  const folders = Array.from(map.keys())
    .filter((k) => k !== "__root__")
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({ folder: k, docs: map.get(k)! }));
  return root.length > 0
    ? [{ folder: null, docs: root }, ...folders]
    : folders;
}

function DocumentLink({ doc }: { doc: OperatorDocument }) {
  const viewer = useFileViewer();
  const Icon = doc.sourceType === "image" ? ImageIcon : FileText;

  return (
    <button
      type="button"
      onClick={() =>
        viewer.open({ kind: "doc", id: doc.id, title: doc.title })
      }
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-[4px] px-3 py-2 text-left",
        "transition-colors hover:bg-[var(--color-muted)]/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
      )}
    >
      <span className="mt-0.5 shrink-0 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-foreground)]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-[var(--color-foreground)]">
          {doc.title}
        </span>
        {doc.summary && (
          <span className="block truncate text-[12px] text-[var(--color-muted-foreground)]">
            {doc.summary}
          </span>
        )}
      </span>
      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]/70 group-hover:text-[var(--color-foreground)]" />
    </button>
  );
}
