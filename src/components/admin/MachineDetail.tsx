"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  Pencil,
  ScanEye,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteAdminDocument,
  getAdminDocumentSignedUrl,
  getAdminMachine,
  updateAdminDocumentSummary,
  updateAdminMachineName,
  uploadAdminDocument,
  type AdminDocument,
  type AdminMachineDetail,
  type UploadResult,
} from "@/admin/adminApi";
import { filesFromDrop } from "@/admin/dropFiles";
import { useConfirm } from "@/components/ui/confirm-dialog";

const DA_DATE = new Intl.DateTimeFormat("da-DK", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function statusBadge(status: string): { label: string; tone: string } {
  switch (status) {
    case "ready":
      return { label: "Klar", tone: "bg-emerald-100 text-emerald-700" };
    case "embedding":
    case "extracting":
    case "uploaded":
      return { label: "Behandler", tone: "bg-amber-100 text-amber-800" };
    case "failed":
      return { label: "Fejlet", tone: "bg-red-100 text-red-700" };
    default:
      return { label: status, tone: "bg-slate-100 text-slate-700" };
  }
}

export function MachineDetail({ machineId }: { machineId: string }) {
  const [data, setData] = useState<AdminMachineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminMachine(machineId)
      .then((detail) => {
        if (cancelled) return;
        setData(detail);
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
  }, [machineId]);

  // Manual refetch after a mutation. Doesn't run on mount — the effect
  // above handles that.
  const reload = useCallback(async () => {
    const detail = await getAdminMachine(machineId);
    setData(detail);
  }, [machineId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[14px] text-red-600">
        {error ?? "Maskinen kunne ikke hentes"}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Link
        href="/admin/machines"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Alle maskiner
      </Link>

      <MachineSummary machine={data} onChanged={reload} />

      <UploadCard machineId={machineId} onUploaded={reload} />

      <DocumentsTable
        documents={data.documents}
        onChanged={reload}
      />
    </div>
  );
}

function MachineSummary({
  machine,
  onChanged,
}: {
  machine: AdminMachineDetail;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(machine.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!draft.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await updateAdminMachineName(machine.machineId, draft.trim());
      await onChanged();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fejl");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  if (e.key === "Escape") {
                    setDraft(machine.displayName ?? "");
                    setEditing(false);
                  }
                }}
                autoFocus
                disabled={saving}
                className={cn(
                  "h-9 flex-1 rounded-[var(--radius)] border border-[var(--color-hairline)]",
                  "bg-[var(--color-background)] px-3 text-[20px] font-semibold",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                )}
              />
              <button
                onClick={() => void save()}
                disabled={saving || !draft.trim()}
                className="rounded-[var(--radius)] p-2 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                aria-label="Gem"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  setDraft(machine.displayName ?? "");
                  setEditing(false);
                  setErr(null);
                }}
                disabled={saving}
                className="rounded-[var(--radius)] p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
                aria-label="Annullér"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="group flex items-center gap-2 text-left"
            >
              <h1 className="truncate text-[24px] font-semibold tracking-tight text-[var(--color-foreground)]">
                {machine.displayName ?? "(uden navn)"}
              </h1>
              <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          {err && (
            <p className="mt-2 text-[13px] text-red-600">{err}</p>
          )}
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted-foreground)]">Machine ID</dt>
              <dd className="font-mono text-[var(--color-foreground)]">{machine.machineId}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted-foreground)]">Konto ID</dt>
              <dd className="font-mono text-[var(--color-foreground)]">{machine.accountId}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted-foreground)]">Dokumenter</dt>
              <dd className="text-[var(--color-foreground)]">{machine.documents.length}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted-foreground)]">Opdateret</dt>
              <dd className="text-[var(--color-foreground)]">
                {DA_DATE.format(new Date(machine.updatedAt))}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

type QueueStatus = "pending" | "uploading" | "done" | "failed";

type QueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  progress: number;
  error?: string;
  result?: UploadResult;
};

function UploadCard({
  machineId,
  onUploaded,
}: {
  machineId: string;
  onUploaded: () => Promise<void>;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  // Mirror of `queue` so the async processing loop reads up-to-date state
  // without juggling setState updaters as data sources.
  const queueRef = useRef<QueueItem[]>([]);

  const update = useCallback(
    (updater: (q: QueueItem[]) => QueueItem[]) => {
      const next = updater(queueRef.current);
      queueRef.current = next;
      setQueue(next);
    },
    [],
  );

  const processNext = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      // Drain the queue one item at a time. Voyage's free-tier rate limits
      // (3 RPM / 10k TPM) make parallel ingestion a bad idea — we'd just
      // 429-and-retry our way to the same total wall time but with worse
      // error visibility.
      while (true) {
        const next = queueRef.current.find((i) => i.status === "pending");
        if (!next) break;

        update((q) =>
          q.map((i) =>
            i.id === next.id ? { ...i, status: "uploading", progress: 0 } : i,
          ),
        );

        try {
          const result = await uploadAdminDocument({
            machineId,
            file: next.file,
            onProgress: (loaded, total) => {
              const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
              update((q) =>
                q.map((i) => (i.id === next.id ? { ...i, progress: pct } : i)),
              );
            },
          });
          update((q) =>
            q.map((i) =>
              i.id === next.id
                ? { ...i, status: "done", progress: 100, result }
                : i,
            ),
          );
          // Refresh the document table after each one — operator gets
          // incremental feedback instead of a bulk reveal at the very end.
          await onUploaded();
        } catch (e) {
          update((q) =>
            q.map((i) =>
              i.id === next.id
                ? {
                    ...i,
                    status: "failed",
                    error: e instanceof Error ? e.message : "Upload fejlede",
                  }
                : i,
            ),
          );
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [machineId, onUploaded, update]);

  const enqueue = useCallback(
    (files: File[]) => {
      const accepted = files.filter(
        (f) =>
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf"),
      );
      if (accepted.length === 0) return;
      const items: QueueItem[] = accepted.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: "pending",
        progress: 0,
      }));
      update((q) => [...q, ...items]);
      void processNext();
    },
    [processNext, update],
  );

  function handleFileInput(list: FileList | null) {
    if (!list || list.length === 0) return;
    enqueue(Array.from(list));
    // Allow re-selecting the same file later.
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDrop(dt: DataTransfer) {
    const files = await filesFromDrop(dt);
    enqueue(files);
  }

  function clearFinished() {
    update((q) => q.filter((i) => i.status !== "done"));
  }

  const pendingOrUploading = queue.some(
    (i) => i.status === "pending" || i.status === "uploading",
  );
  const finishedCount = queue.filter((i) => i.status === "done").length;
  const failedCount = queue.filter((i) => i.status === "failed").length;

  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <h2 className="text-[16px] font-semibold text-[var(--color-foreground)]">
        Upload manualer
      </h2>
      <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
        Træk én eller flere PDF&#39;er — eller en hel mappe — hertil. Filerne
        køres igennem en ad gangen pga. embeddings-rate-limits. Du kan redigere
        beskrivelser i tabellen efter upload.
      </p>

      <div
        className={cn(
          "mt-4 flex flex-col items-center justify-center gap-2 rounded-[var(--radius)]",
          "border border-dashed px-4 py-8 text-center transition-colors",
          dragActive
            ? "border-[var(--color-brand)] bg-[var(--color-brand)]/5"
            : "border-[var(--color-hairline)] bg-[var(--color-background)]",
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          void handleDrop(e.dataTransfer);
        }}
      >
        <Upload className="h-5 w-5 text-[var(--color-muted-foreground)]" />
        <p className="text-[14px] text-[var(--color-muted-foreground)]">
          Træk PDF&#39;er eller en mappe hertil, eller{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-[var(--color-brand)] hover:underline"
          >
            vælg filer
          </button>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFileInput(e.target.files)}
        />
      </div>

      {queue.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[12px] text-[var(--color-muted-foreground)]">
            <span>
              {pendingOrUploading
                ? `Behandler ${queue.length - finishedCount - failedCount} af ${queue.length}…`
                : `${finishedCount} færdig${finishedCount === 1 ? "" : "e"}${
                    failedCount > 0 ? `, ${failedCount} fejlet` : ""
                  }`}
            </span>
            {!pendingOrUploading && finishedCount > 0 && (
              <button
                type="button"
                onClick={clearFinished}
                className="hover:text-[var(--color-foreground)]"
              >
                Ryd færdige
              </button>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-hairline)]">
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  return (
    <li className="flex items-center gap-3 bg-[var(--color-surface)] px-3 py-2 text-[13px]">
      <QueueStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[var(--color-foreground)]">
            {item.file.name}
          </span>
          <span className="shrink-0 text-[12px] text-[var(--color-muted-foreground)]">
            {formatBytes(item.file.size)}
          </span>
          {item.result?.extractionSource === "claude-ocr" && (
            <span
              title="Tekst udvundet med Claude vision (OCR)"
              className="inline-flex items-center"
            >
              <ScanEye
                aria-label="Claude vision OCR"
                className="h-3.5 w-3.5 text-violet-600"
              />
            </span>
          )}
        </div>
        {item.status === "uploading" && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-[var(--color-muted)]">
            <div
              className="h-full bg-[var(--color-brand)] transition-[width] duration-200"
              style={{
                width: `${item.progress < 100 ? item.progress : 100}%`,
                opacity: item.progress < 100 ? 1 : 0.7,
              }}
            />
          </div>
        )}
        {item.status === "uploading" && item.progress >= 100 && (
          <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
            Behandler & embedder…
          </p>
        )}
        {item.status === "done" && item.result && (
          <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
            {item.result.chunkCount} chunks fra {item.result.pageCount} sider
          </p>
        )}
        {item.status === "failed" && item.error && (
          <p className="mt-0.5 truncate text-[12px] text-red-600">
            {item.error}
          </p>
        )}
      </div>
    </li>
  );
}

function QueueStatusIcon({ status }: { status: QueueStatus }) {
  switch (status) {
    case "pending":
      return (
        <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--color-hairline)]" />
      );
    case "uploading":
      return (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-brand)]" />
      );
    case "done":
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />;
    case "failed":
      return <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />;
  }
}

function DocumentsTable({
  documents,
  onChanged,
}: {
  documents: AdminDocument[];
  onChanged: () => Promise<void>;
}) {
  if (documents.length === 0) {
    return (
      <section className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
        Ingen manualer endnu. Upload den første ovenfor.
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <table className="w-full text-[14px]">
        <thead className="bg-[var(--color-muted)] text-left text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
          <tr>
            <th className="px-4 py-3 font-medium">Titel</th>
            <th className="px-4 py-3 font-medium">Beskrivelse</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Sider</th>
            <th className="px-4 py-3 text-right font-medium">Størrelse</th>
            <th className="px-4 py-3 font-medium">Oprettet</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <DocumentRow key={d.id} document={d} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DocumentRow({
  document,
  onChanged,
}: {
  document: AdminDocument;
  onChanged: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(document.summary);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function viewOriginal() {
    if (opening) return;
    // Open the popup synchronously inside the click handler so popup
    // blockers don't catch the later navigation. We can't pass
    // "noopener" here because that nukes the returned window handle —
    // we instead null out `opener` after navigating to break the reverse
    // reference, achieving the same security guarantee.
    const w = window.open("", "_blank");
    setOpening(true);
    setErr(null);
    try {
      const { url } = await getAdminDocumentSignedUrl(document.id);
      if (!w) {
        setErr(
          "Browseren blokerede pop-up. Tillad pop-ups eller brug download-knappen.",
        );
        return;
      }
      w.opener = null;
      w.location.href = url;
    } catch (e) {
      w?.close();
      setErr(e instanceof Error ? e.message : "Kunne ikke åbne fil");
    } finally {
      setOpening(false);
    }
  }

  async function downloadOriginal() {
    if (downloading) return;
    setDownloading(true);
    setErr(null);
    try {
      const { url, fileName } = await getAdminDocumentSignedUrl(document.id, {
        download: true,
      });
      const a = window.document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Kunne ikke hente fil");
    } finally {
      setDownloading(false);
    }
  }

  async function saveSummary() {
    if (!draft.trim() || draft.trim() === document.summary) {
      setEditing(false);
      setDraft(document.summary);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await updateAdminDocumentSummary(document.id, draft.trim());
      await onChanged();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fejl");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Slet "${document.title}"?`,
      description:
        "Dokumentet og alle dets embeddings fjernes permanent. Handlingen kan ikke fortrydes.",
      confirmLabel: "Slet",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    setErr(null);
    try {
      await deleteAdminDocument(document.id);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fejl");
      setDeleting(false);
    }
  }

  const badge = statusBadge(document.status);

  return (
    <tr className="border-t border-[var(--color-hairline)]">
      <td className="px-4 py-3 font-medium text-[var(--color-foreground)]">
        <span className="flex items-center gap-1.5">
          {document.title}
          {document.extractionSource === "claude-ocr" && (
            <span title="Tekst udvundet med Claude vision (OCR)">
              <ScanEye
                aria-label="Claude vision OCR"
                className="h-3.5 w-3.5 shrink-0 text-violet-600"
              />
            </span>
          )}
        </span>
      </td>
      <td className="px-4 py-3 text-[var(--color-foreground)]">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveSummary();
                if (e.key === "Escape") {
                  setDraft(document.summary);
                  setEditing(false);
                }
              }}
              autoFocus
              disabled={saving}
              className={cn(
                "h-8 flex-1 rounded-[var(--radius)] border border-[var(--color-hairline)]",
                "bg-[var(--color-background)] px-2 text-[14px]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              )}
            />
            <button
              onClick={() => void saveSummary()}
              disabled={saving}
              className="p-1 text-emerald-700 hover:bg-emerald-50 rounded"
              aria-label="Gem"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => {
                setDraft(document.summary);
                setEditing(false);
              }}
              disabled={saving}
              className="p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] rounded"
              aria-label="Annullér"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="group flex w-full items-center gap-2 text-left"
          >
            <span className="truncate">{document.summary}</span>
            <Pencil className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        {err && <p className="mt-1 text-[12px] text-red-600">{err}</p>}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            badge.tone,
          )}
        >
          {badge.label}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-foreground)]">
        {document.pageCount ?? "—"}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-muted-foreground)]">
        {formatBytes(document.byteSize)}
      </td>
      <td className="px-4 py-3 text-[var(--color-muted-foreground)]">
        {DA_DATE.format(new Date(document.createdAt))}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-0.5">
          <button
            onClick={() => void viewOriginal()}
            disabled={opening}
            title="Åbn original"
            aria-label="Åbn original"
            className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-40"
          >
            {opening ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => void downloadOriginal()}
            disabled={downloading}
            title="Download original"
            aria-label="Download original"
            className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-40"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => void remove()}
            disabled={deleting}
            title="Slet dokument"
            aria-label="Slet dokument"
            className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}
