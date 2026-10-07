"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Folder,
  Image as ImageIcon,
  LogIn,
  RefreshCw,
  ScanEye,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tag } from "@/components/ui/tag";
import {
  AdminApiError,
  adminErrorMessage,
  reprocessAdminDocument,
  resumeAdminDocument,
  uploadAdminDocument,
  uploadAdminFile,
  uploadAdminImage,
  uploadContentType,
  type AdminDocument,
  type FileUploadResult,
  type ImageUploadResult,
  type ReprocessResult,
  type UploadResult,
} from "@/admin/adminApi";
import { SessionExpiredError } from "@/auth/authApi";
import { useAuth } from "@/auth/AuthContext";
import type { DroppedFile } from "@/admin/dropFiles";

// One shared queue handles both fresh uploads and reprocesses so they
// share the Voyage rate-limit budget. Items run strictly sequentially —
// Voyage's free tier (3 RPM / 10k TPM) makes parallel embedding worse
// than serial in wall-clock time, and the audit story is cleaner when
// each doc finishes before the next starts.

type QueueStatus = "pending" | "uploading" | "done" | "failed";

type Base = {
  id: string;
  // Captured at enqueue time so the loop never reads a stale provider
  // prop if the admin switches machine while items are still running.
  machineId: string;
  status: QueueStatus;
  progress: number;
  error?: string;
};

type UploadQueueItem = Base & {
  kind: "upload";
  // Discriminates which ingest endpoint to call. Drag-drop and the file
  // picker both classify per-file so a single batch can mix PDFs, images
  // and arbitrary files without special-casing in the queue loop.
  fileKind: "pdf" | "image" | "file";
  file: File;
  folderPath: string | null;
  // Set the moment /sign answers. From then on the bytes (once PUT) live
  // in Storage under this id, so a retry re-POSTs finalize instead of
  // uploading again — and the panel can pair this row with the server's
  // progress row for the same document.
  documentId?: string;
  // True once the PUT completed: finalize is the only step left, so a
  // retry may resume. Before that a retry has to re-upload (a stale
  // signed URL can't be reused).
  uploaded?: boolean;
  // A document with the same title already exists in this machine's KB.
  // Informational — the upload still runs.
  duplicateTitle?: boolean;
  result?: UploadResult | ImageUploadResult | FileUploadResult;
};

type ReprocessQueueItem = Base & {
  kind: "reprocess";
  documentId: string;
  documentTitle: string;
  fileSize: number | null;
  // "ocr" only when the admin explicitly asked for a Claude vision pass;
  // otherwise the server auto-detects the extraction path.
  force?: "ocr";
  result?: ReprocessResult;
};

export type QueueItem = UploadQueueItem | ReprocessQueueItem;

export type EnqueueUploadOptions = {
  // Titles (filename sans extension) already present in the machine's
  // document list, used to flag likely duplicates on the queued rows.
  existingTitles?: ReadonlySet<string>;
  // Zero-byte files the drop/picker discarded before enqueueing.
  skippedEmpty?: number;
};

type QueueAPI = {
  enqueueUploads: (files: DroppedFile[], opts?: EnqueueUploadOptions) => void;
  enqueueReprocess: (args: {
    documentId: string;
    documentTitle: string;
    fileSize: number | null;
    force?: "ocr";
  }) => void;
  queue: QueueItem[];
  processingDocs: AdminDocument[];
  // Set when the loop stopped because the session expired mid-queue.
  // Remaining items stay pending until the admin logs in again.
  sessionExpired: boolean;
  skippedEmpty: number;
  clearFinished: () => void;
  retryItem: (id: string) => void;
  retryAllFailed: () => void;
};

const QueueContext = createContext<QueueAPI | null>(null);

export function useUploadQueue(): QueueAPI {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useUploadQueue requires <UploadQueueProvider>");
  return ctx;
}

// Title as the server derives it from the upload's file name.
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

// The pipeline writes machine-readable progress codes of the form
// `phase:<code>` with optional `|k=v` params, e.g.
// `phase:embedding|done=12|total=40`. Translate those under
// admin.uploadQueue.phase.*; anything else (legacy labels, failure
// sentences) passes through verbatim.
const PHASE_CODES = new Set([
  "reading_pdf",
  "ocr",
  "tables",
  "chunking",
  "embedding",
  "figures",
  "reading_file",
  "describing_image",
  "embedding_caption",
]);

export function formatProgressLabel(
  label: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!label.startsWith("phase:")) return label;
  const [head, ...rest] = label.slice("phase:".length).split("|");
  if (!PHASE_CODES.has(head)) return label;
  const params: Record<string, string | number> = {};
  for (const kv of rest) {
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    const key = kv.slice(0, eq);
    const raw = kv.slice(eq + 1);
    const num = Number(raw);
    params[key] = raw !== "" && Number.isFinite(num) ? num : raw;
  }
  // Every phase key declares its params; ICU tolerates extras but not
  // missing ones, so default the known numeric ones to 0.
  if (head === "chunking") params.pages ??= 0;
  if (head === "embedding") {
    params.done ??= 0;
    params.total ??= 0;
  }
  return t(`phase.${head}`, params);
}

function isSessionExpiry(err: unknown): boolean {
  return (
    err instanceof SessionExpiredError ||
    (err instanceof AdminApiError && err.params.status === 401)
  );
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function UploadQueueProvider({
  machineId,
  processingDocs,
  onChanged,
  children,
}: {
  machineId: string;
  // Docs the server is actively chewing on right now (status !== 'ready'
  // && !== 'failed'). Surfaced in the queue panel as a persistent
  // section so a refresh still shows what's still cooking.
  processingDocs: AdminDocument[];
  onChanged: () => Promise<void>;
  children: ReactNode;
}) {
  const t = useTranslations("admin.uploadQueue");
  const tErr = useTranslations("admin.apiErrors");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [skippedEmpty, setSkippedEmpty] = useState(0);
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);

  const update = useCallback(
    (updater: (q: QueueItem[]) => QueueItem[]) => {
      const next = updater(queueRef.current);
      queueRef.current = next;
      setQueue(next);
    },
    [],
  );

  // Shallow-patch one item. The patch is typed loosely (union of both
  // item shapes, all optional) because callers already know which kind
  // they hold; the discriminant `kind` is never patched.
  type ItemPatch = Partial<Omit<UploadQueueItem, "kind" | "result">> &
    Partial<Omit<ReprocessQueueItem, "kind" | "result">> & {
      result?: UploadQueueItem["result"] | ReprocessQueueItem["result"];
    };
  const patchItem = useCallback(
    (id: string, patch: ItemPatch) => {
      update((q) =>
        q.map((i) =>
          i.id === id
            ? ({ ...i, ...patch } as unknown as QueueItem)
            : i,
        ),
      );
    },
    [update],
  );

  // A refetch failure must never mark a finished item as failed — the
  // work is done server-side regardless. Log and move on; the poller in
  // MachineDetail catches up on the next tick.
  const refresh = useCallback(async () => {
    try {
      await onChanged();
    } catch (err) {
      console.warn("upload queue: refresh after change failed", err);
    }
  }, [onChanged]);

  const processNext = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (true) {
        const next = queueRef.current.find((i) => i.status === "pending");
        if (!next) break;
        patchItem(next.id, { status: "uploading", progress: 0 });

        try {
          if (next.kind === "upload") {
            const onProgress = (loaded: number, total: number) => {
              const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
              patchItem(next.id, { progress: pct });
            };
            let result: UploadQueueItem["result"];
            if (next.documentId && next.uploaded) {
              // Bytes are already in Storage — only finalize is missing.
              // Re-POST it with the same body; the server resumes from
              // its checkpoint (or answers done:true if it finished
              // while we weren't looking).
              patchItem(next.id, { progress: 100 });
              result = await resumeAdminDocument<
                UploadResult | ImageUploadResult | FileUploadResult
              >({
                kind: next.fileKind,
                machineId: next.machineId,
                documentId: next.documentId,
                fileName: next.file.name,
                contentType: uploadContentType(next.fileKind, next.file),
                folderPath: next.folderPath,
              });
            } else {
              const uploadArgs = {
                machineId: next.machineId,
                file: next.file,
                folderPath: next.folderPath,
                onProgress: (loaded: number, total: number) => {
                  onProgress(loaded, total);
                  if (loaded >= total && total > 0) {
                    patchItem(next.id, { uploaded: true });
                  }
                },
                onSigned: (documentId: string) => {
                  patchItem(next.id, { documentId });
                  // The server row exists now; refetch so it shows up and
                  // drives real progress once the pipeline starts.
                  void refresh();
                },
              };
              result =
                next.fileKind === "image"
                  ? await uploadAdminImage(uploadArgs)
                  : next.fileKind === "file"
                    ? await uploadAdminFile(uploadArgs)
                    : await uploadAdminDocument(uploadArgs);
            }
            patchItem(next.id, {
              status: "done",
              progress: 100,
              uploaded: true,
              result,
            });
          } else {
            // Reprocess: there's no streaming progress, so we sit on
            // 100% + a "processing" label until the server returns.
            patchItem(next.id, { progress: 100 });
            const result = await reprocessAdminDocument(
              next.documentId,
              next.force,
            );
            patchItem(next.id, { status: "done", progress: 100, result });
          }
        } catch (e) {
          if (isSessionExpiry(e)) {
            // Nothing else in the queue can succeed until the admin logs
            // in again. Mark this item, leave the rest pending, stop.
            patchItem(next.id, { status: "failed", error: t("sessionExpired") });
            setSessionExpired(true);
            break;
          }
          patchItem(next.id, {
            status: "failed",
            error: adminErrorMessage(e, tErr) ?? t("failed"),
          });
          continue;
        }
        await refresh();
      }
    } finally {
      processingRef.current = false;
    }
  }, [patchItem, refresh, t, tErr]);

  const enqueueUploads = useCallback(
    (files: DroppedFile[], opts: EnqueueUploadOptions = {}) => {
      setSkippedEmpty(opts.skippedEmpty ?? 0);
      if (files.length === 0) return;
      const items: UploadQueueItem[] = files.map(({ file, folderPath, kind }) => ({
        kind: "upload",
        fileKind: kind,
        id: newId(),
        machineId,
        file,
        folderPath,
        duplicateTitle:
          opts.existingTitles?.has(titleFromFileName(file.name)) ?? false,
        status: "pending",
        progress: 0,
      }));
      update((q) => [...q, ...items]);
      void processNext();
    },
    [machineId, processNext, update],
  );

  const enqueueReprocess = useCallback(
    (args: {
      documentId: string;
      documentTitle: string;
      fileSize: number | null;
      force?: "ocr";
    }) => {
      // Don't enqueue duplicates if the same doc is already in flight.
      const already = queueRef.current.some(
        (i) =>
          i.kind === "reprocess" &&
          i.documentId === args.documentId &&
          (i.status === "pending" || i.status === "uploading"),
      );
      if (already) return;

      const item: ReprocessQueueItem = {
        kind: "reprocess",
        id: newId(),
        machineId,
        documentId: args.documentId,
        documentTitle: args.documentTitle,
        fileSize: args.fileSize,
        force: args.force,
        status: "pending",
        progress: 0,
      };
      update((q) => [...q, item]);
      void processNext();
    },
    [machineId, processNext, update],
  );

  const clearFinished = useCallback(() => {
    update((q) => q.filter((i) => i.status !== "done"));
    setSkippedEmpty(0);
  }, [update]);

  const retryItem = useCallback(
    (id: string) => {
      update((q) =>
        q.map((i) =>
          i.id === id && i.status === "failed"
            ? { ...i, status: "pending" as const, progress: 0, error: undefined }
            : i,
        ),
      );
      void processNext();
    },
    [processNext, update],
  );

  const retryAllFailed = useCallback(() => {
    update((q) =>
      q.map((i) =>
        i.status === "failed"
          ? { ...i, status: "pending" as const, progress: 0, error: undefined }
          : i,
      ),
    );
    void processNext();
  }, [processNext, update]);

  // Warn before the tab closes while items are still pending/uploading —
  // the in-tab queue doesn't survive a navigation.
  const hasActive = queue.some(
    (i) => i.status === "pending" || i.status === "uploading",
  );
  useEffect(() => {
    if (!hasActive) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasActive]);

  const api: QueueAPI = {
    enqueueUploads,
    enqueueReprocess,
    queue,
    processingDocs,
    sessionExpired,
    skippedEmpty,
    clearFinished,
    retryItem,
    retryAllFailed,
  };
  return (
    <QueueContext.Provider value={api}>{children}</QueueContext.Provider>
  );
}

export function UploadQueuePanel() {
  const {
    queue,
    processingDocs,
    sessionExpired,
    skippedEmpty,
    clearFinished: onClearFinished,
    retryAllFailed,
  } = useUploadQueue();
  const t = useTranslations("admin.uploadQueue");
  const { logout } = useAuth();
  // Drop server-processing rows for docs the in-tab queue is already
  // showing — an in-flight reprocess, or an upload whose /sign call has
  // minted its row. Avoids duplicate rows for the same work.
  const inTabDocIds = new Set<string>();
  for (const i of queue) {
    if (i.status !== "uploading") continue;
    if (i.kind === "reprocess") inTabDocIds.add(i.documentId);
    else if (i.documentId) inTabDocIds.add(i.documentId);
  }
  const serverRows = processingDocs.filter((d) => !inTabDocIds.has(d.id));

  if (queue.length === 0 && serverRows.length === 0 && skippedEmpty === 0) {
    return null;
  }

  const pendingOrUploading = queue.some(
    (i) => i.status === "pending" || i.status === "uploading",
  );
  const finishedCount = queue.filter((i) => i.status === "done").length;
  const failedCount = queue.filter((i) => i.status === "failed").length;

  return (
    <section className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <div className="flex items-center justify-between text-[12px]">
        <h2 className="text-[14px] font-semibold text-[var(--color-foreground)]">
          {t("heading")}
        </h2>
        <span className="text-[var(--color-muted-foreground)]">
          {serverRows.length > 0
            ? pendingOrUploading
              ? t("serverWithTab", {
                  server: serverRows.length,
                  tab: queue.length - finishedCount - failedCount,
                })
              : t("serverOnly", { server: serverRows.length })
            : pendingOrUploading
              ? t("inProgress", {
                  remaining: queue.length - finishedCount - failedCount,
                  total: queue.length,
                })
              : t("doneCount", { done: finishedCount }) +
                (failedCount > 0 ? t("failedSuffix", { failed: failedCount }) : "")}
        </span>
        {failedCount > 0 && !sessionExpired && (
          <button
            type="button"
            onClick={retryAllFailed}
            className="ml-3 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            {t("retryAllFailed")}
          </button>
        )}
        {!pendingOrUploading && finishedCount > 0 && (
          <button
            type="button"
            onClick={onClearFinished}
            className="ml-3 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            {t("clearFinished")}
          </button>
        )}
      </div>

      {sessionExpired && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--ds-red-bg)] px-3 py-2 text-[13px] text-[var(--ds-red)]">
          <span className="min-w-0 flex-1">{t("sessionExpiredBanner")}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={logout}
            className="shrink-0"
          >
            <LogIn className="mr-1.5 h-3.5 w-3.5" />
            {t("sessionExpiredAction")}
          </Button>
        </div>
      )}

      {skippedEmpty > 0 && (
        <p className="mt-3 text-[12px] text-[var(--color-muted-foreground)]">
          {t("skippedEmpty", { count: skippedEmpty })}
        </p>
      )}

      {serverRows.length > 0 && (
        <>
          <p className="mt-3 text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {t("serverProcessing")}
          </p>
          <ul className="mt-1.5 flex flex-col divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[4px] border border-[var(--color-hairline)]">
            {serverRows.map((d) => (
              <ServerRow key={d.id} doc={d} />
            ))}
          </ul>
        </>
      )}

      {queue.length > 0 && (
        <>
          {serverRows.length > 0 && (
            <p className="mt-4 text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {t("thisTab")}
            </p>
          )}
          <ul className={cn(
            serverRows.length > 0 ? "mt-1.5" : "mt-3",
            "flex flex-col divide-y divide-[var(--color-hairline)] overflow-hidden rounded-[4px] border border-[var(--color-hairline)]",
          )}>
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ServerRow({ doc }: { doc: AdminDocument }) {
  const t = useTranslations("admin.uploadQueue");
  // Prefer the fine-grained label written by the pipeline; fall back to
  // a status-derived word for legacy rows that landed in a non-terminal
  // state before the progress columns existed.
  const fallbackLabel =
    doc.status === "uploaded"
      ? t("statusReceived")
      : doc.status === "extracting"
        ? t("statusExtracting")
        : doc.status === "embedding"
          ? t("statusEmbedding")
          : doc.status;
  const label = doc.progressLabel
    ? formatProgressLabel(doc.progressLabel, t)
    : fallbackLabel;
  const pct = doc.progress;

  return (
    <li className="flex items-center gap-3 bg-[var(--color-surface)] px-3 py-2 text-[13px]">
      <Spinner className="h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[var(--color-foreground)]">
            {doc.title}
          </span>
          {doc.folderPath && (
            <Tag variant="default" size="small">
              <Folder className="mr-1 h-3 w-3" />
              {doc.folderPath}
            </Tag>
          )}
          {doc.extractionSource === "claude-ocr" && (
            <span title={t("ocrTooltip")}>
              <ScanEye className="h-3.5 w-3.5 text-violet-600" />
            </span>
          )}
          {doc.extractionSource === "pdf-parse+tables" && (
            <span title={t("tablesTooltip")}>
              <Table2 className="h-3.5 w-3.5 text-violet-600" />
            </span>
          )}
        </div>
        {pct != null ? (
          <>
            <ProgressBar className="mt-1.5" value={pct} />
            <p className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-[var(--color-muted-foreground)]">
              <span className="truncate">{label}…</span>
              <span className="shrink-0 tabular-nums">{pct}%</span>
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
            {label}…
          </p>
        )}
      </div>
    </li>
  );
}

function formatBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function QueueRow({ item }: { item: QueueItem }) {
  const t = useTranslations("admin.uploadQueue");
  const tc = useTranslations("common");
  const { retryItem, sessionExpired } = useUploadQueue();
  const title = item.kind === "upload" ? item.file.name : item.documentTitle;
  const size = item.kind === "upload" ? item.file.size : item.fileSize;
  const isImage = item.kind === "upload" && item.fileKind === "image";
  const forcedOcr = item.kind === "reprocess" && item.force === "ocr";
  // Type guards: only PDF uploads (and reprocesses) carry an
  // extractionSource. Image uploads return ImageUploadResult instead.
  const ocrResult =
    item.kind === "upload" && item.fileKind === "pdf"
      ? (item.result as UploadResult | undefined)?.extractionSource ===
        "claude-ocr"
      : item.kind === "reprocess"
        ? item.result?.extractionSource === "claude-ocr"
        : false;
  // A resumable item re-POSTs finalize on retry rather than uploading
  // the bytes again — tell the admin so the instant jump to 100% isn't
  // mistaken for a glitch.
  const resumable =
    item.kind === "upload" && !!item.documentId && !!item.uploaded;

  return (
    <li className="flex items-center gap-3 bg-[var(--color-surface)] px-3 py-2 text-[13px]">
      <QueueStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.kind === "reprocess" && (
            <Tag variant="warning" size="small">
              {forcedOcr ? "OCR" : t("reindexTag")}
            </Tag>
          )}
          {isImage ? (
            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          ) : item.kind === "upload" ? (
            <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          ) : null}
          <span className="truncate font-medium text-[var(--color-foreground)]">
            {title}
          </span>
          <span className="shrink-0 text-[12px] text-[var(--color-muted-foreground)]">
            {formatBytes(size)}
          </span>
          {item.kind === "upload" && item.folderPath && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted-foreground)]">
              <Folder className="h-3 w-3" />
              {item.folderPath}
            </span>
          )}
          {item.kind === "upload" && item.duplicateTitle && (
            <Tag variant="warning" size="small" title={t("duplicateTitleHint")}>
              {t("duplicateTitle")}
            </Tag>
          )}
          {ocrResult && (
            <span title={t("ocrTooltip")}>
              <ScanEye
                aria-label={t("ocrAria")}
                className="h-3.5 w-3.5 text-violet-600"
              />
            </span>
          )}
        </div>
        {item.status === "uploading" && item.kind === "upload" && (
          <ProgressBar
            className="mt-1.5"
            value={item.progress}
            style={{ opacity: item.progress < 100 ? 1 : 0.7 }}
          />
        )}
        {item.status === "uploading" && (
          <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
            {item.kind === "upload" && item.progress < 100
              ? t("uploadingPct", { pct: item.progress })
              : item.kind === "reprocess"
                ? forcedOcr
                  ? t("ocrEmbedding")
                  : t("reindexing")
                : isImage
                  ? t("describingImage")
                  : t("processingEmbedding")}
          </p>
        )}
        {item.status === "done" &&
          item.kind === "upload" &&
          item.result &&
          item.fileKind === "pdf" && (
            <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
              {t("chunksFromPages", {
                chunks: (item.result as UploadResult).chunkCount,
                pages: (item.result as UploadResult).pageCount,
              })}
            </p>
          )}
        {item.status === "done" &&
          item.kind === "upload" &&
          item.result &&
          item.fileKind === "image" && (
            <p className="mt-0.5 line-clamp-1 text-[12px] text-[var(--color-muted-foreground)]">
              {(item.result as ImageUploadResult).altText}
            </p>
          )}
        {item.status === "done" &&
          item.kind === "upload" &&
          item.result &&
          item.fileKind === "file" && (
            <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
              {(item.result as FileUploadResult).textIngested
                ? t("fileChunks", {
                    chunks: (item.result as FileUploadResult).chunkCount,
                  })
                : t("fileStoredOnly")}
            </p>
          )}
        {item.status === "done" &&
          item.kind === "reprocess" &&
          item.result && (
            <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
              {t("chunksReembedded", {
                chunks: item.result.chunkCount,
                pages: item.result.pageCount,
              })}
            </p>
          )}
        {item.status === "failed" && item.error && (
          <p className="mt-0.5 truncate text-[12px] text-[var(--ds-red)]">
            {item.error}
            {resumable && (
              <span className="text-[var(--color-muted-foreground)]">
                {" "}
                · {t("resumeHint")}
              </span>
            )}
          </p>
        )}
      </div>
      {item.status === "failed" && !sessionExpired && (
        <Button
          variant="ghost"
          size="pill"
          onClick={() => retryItem(item.id)}
          className="shrink-0"
          title={resumable ? t("resumeTitle") : undefined}
        >
          <RefreshCw className="h-3 w-3" />
          {resumable ? t("resume") : tc("retry")}
        </Button>
      )}
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
        <Spinner className="h-3.5 w-3.5 shrink-0" />
      );
    case "done":
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ds-green)]" />;
    case "failed":
      return <AlertCircle className="h-4 w-4 shrink-0 text-[var(--ds-red)]" />;
  }
}
