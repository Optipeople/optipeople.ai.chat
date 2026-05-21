"use client";

import {
  createContext,
  useCallback,
  useContext,
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
  ScanEye,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tag } from "@/components/ui/tag";
import {
  reprocessAdminDocument,
  uploadAdminDocument,
  uploadAdminImage,
  type AdminDocument,
  type ImageUploadResult,
  type ReprocessResult,
  type UploadResult,
} from "@/admin/adminApi";
import type { DroppedFile } from "@/admin/dropFiles";

// One shared queue handles both fresh uploads and OCR reprocesses so
// they share the Voyage rate-limit budget. Items run strictly
// sequentially — Voyage's free tier (3 RPM / 10k TPM) makes parallel
// embedding worse than serial in wall-clock time, and the audit story
// is cleaner when each doc finishes before the next starts.

type QueueStatus = "pending" | "uploading" | "done" | "failed";

type Base = {
  id: string;
  status: QueueStatus;
  progress: number;
  error?: string;
};

type UploadQueueItem = Base & {
  kind: "upload";
  // Discriminates which ingest endpoint to call. Drag-drop and the file
  // picker both classify per-file so a single batch can mix PDFs and
  // images without special-casing in the queue loop.
  fileKind: "pdf" | "image";
  file: File;
  folderPath: string | null;
  result?: UploadResult | ImageUploadResult;
};

type ReprocessQueueItem = Base & {
  kind: "reprocess";
  documentId: string;
  documentTitle: string;
  fileSize: number | null;
  result?: ReprocessResult;
};

export type QueueItem = UploadQueueItem | ReprocessQueueItem;

type QueueAPI = {
  enqueueUploads: (files: DroppedFile[]) => void;
  enqueueReprocess: (args: {
    documentId: string;
    documentTitle: string;
    fileSize: number | null;
  }) => void;
};

const QueueContext = createContext<QueueAPI | null>(null);

export function useUploadQueue(): QueueAPI {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useUploadQueue requires <UploadQueueProvider>");
  return ctx;
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
  const [queue, setQueue] = useState<QueueItem[]>([]);
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

  const processNext = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (true) {
        const next = queueRef.current.find((i) => i.status === "pending");
        if (!next) break;
        update((q) =>
          q.map((i) =>
            i.id === next.id ? { ...i, status: "uploading", progress: 0 } : i,
          ),
        );

        try {
          if (next.kind === "upload") {
            const onProgress = (loaded: number, total: number) => {
              const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
              update((q) =>
                q.map((i) =>
                  i.id === next.id ? { ...i, progress: pct } : i,
                ),
              );
            };
            const result =
              next.fileKind === "image"
                ? await uploadAdminImage({
                    machineId,
                    file: next.file,
                    folderPath: next.folderPath,
                    onProgress,
                  })
                : await uploadAdminDocument({
                    machineId,
                    file: next.file,
                    folderPath: next.folderPath,
                    onProgress,
                  });
            update((q) =>
              q.map((i) =>
                i.id === next.id
                  ? ({ ...i, status: "done", progress: 100, result } as QueueItem)
                  : i,
              ),
            );
          } else {
            // Reprocess: there's no streaming progress, so we sit on
            // 100% upload + a "behandler" label until the server returns.
            update((q) =>
              q.map((i) =>
                i.id === next.id ? { ...i, progress: 100 } : i,
              ),
            );
            const result = await reprocessAdminDocument(next.documentId, "ocr");
            update((q) =>
              q.map((i) =>
                i.id === next.id
                  ? ({ ...i, status: "done", progress: 100, result } as QueueItem)
                  : i,
              ),
            );
          }
          await onChanged();
        } catch (e) {
          update((q) =>
            q.map((i) =>
              i.id === next.id
                ? {
                    ...i,
                    status: "failed",
                    error: e instanceof Error ? e.message : t("failed"),
                  }
                : i,
            ),
          );
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [machineId, onChanged, update]);

  const enqueueUploads = useCallback(
    (files: DroppedFile[]) => {
      if (files.length === 0) return;
      const items: UploadQueueItem[] = files.map(({ file, folderPath, kind }) => ({
        kind: "upload",
        fileKind: kind,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        folderPath,
        status: "pending",
        progress: 0,
      }));
      update((q) => [...q, ...items]);
      void processNext();
    },
    [processNext, update],
  );

  const enqueueReprocess = useCallback(
    (args: {
      documentId: string;
      documentTitle: string;
      fileSize: number | null;
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
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        documentId: args.documentId,
        documentTitle: args.documentTitle,
        fileSize: args.fileSize,
        status: "pending",
        progress: 0,
      };
      update((q) => [...q, item]);
      void processNext();
    },
    [processNext, update],
  );

  const clearFinished = useCallback(() => {
    update((q) => q.filter((i) => i.status !== "done"));
  }, [update]);

  const api = { enqueueUploads, enqueueReprocess };
  return (
    <QueueContext.Provider value={api}>
      {children}
      <UploadQueuePanel
        queue={queue}
        processingDocs={processingDocs}
        onClearFinished={clearFinished}
      />
    </QueueContext.Provider>
  );
}

function UploadQueuePanel({
  queue,
  processingDocs,
  onClearFinished,
}: {
  queue: QueueItem[];
  processingDocs: AdminDocument[];
  onClearFinished: () => void;
}) {
  const t = useTranslations("admin.uploadQueue");
  // Drop server-processing rows for docs the in-tab queue is already
  // showing (an in-flight reprocess from this tab). Avoids duplicate
  // rows for the same work.
  const inTabReprocessIds = new Set(
    queue
      .filter((i) => i.kind === "reprocess" && i.status === "uploading")
      .map((i) => (i as { documentId: string }).documentId),
  );
  const serverRows = processingDocs.filter(
    (d) => !inTabReprocessIds.has(d.id),
  );

  if (queue.length === 0 && serverRows.length === 0) return null;

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
              : (finishedCount === 1
                  ? t("doneCountOne", { done: finishedCount })
                  : t("doneCount", { done: finishedCount })) +
                (failedCount > 0 ? t("failedSuffix", { failed: failedCount }) : "")}
        </span>
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
  const label = doc.progressLabel ?? fallbackLabel;
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
  const title = item.kind === "upload" ? item.file.name : item.documentTitle;
  const size = item.kind === "upload" ? item.file.size : item.fileSize;
  const isImage = item.kind === "upload" && item.fileKind === "image";
  // Type guards: only PDF uploads (and reprocesses) carry an
  // extractionSource. Image uploads return ImageUploadResult instead.
  const ocrResult =
    item.kind === "upload" && item.fileKind === "pdf"
      ? (item.result as UploadResult | undefined)?.extractionSource ===
        "claude-ocr"
      : item.kind === "reprocess"
        ? item.result?.extractionSource === "claude-ocr"
        : false;

  return (
    <li className="flex items-center gap-3 bg-[var(--color-surface)] px-3 py-2 text-[13px]">
      <QueueStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.kind === "reprocess" && (
            <Tag variant="warning" size="small">
              OCR
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
                ? t("ocrEmbedding")
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
        <Spinner className="h-3.5 w-3.5 shrink-0" />
      );
    case "done":
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ds-green)]" />;
    case "failed":
      return <AlertCircle className="h-4 w-4 shrink-0 text-[var(--ds-red)]" />;
  }
}
