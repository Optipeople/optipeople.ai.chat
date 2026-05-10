"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Folder,
  FolderOpen,
  GripVertical,
  History,
  Loader2,
  MessageSquare,
  MessageSquareQuote,
  Pencil,
  QrCode,
  RefreshCw,
  ScanEye,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createAdminFolder,
  deleteAdminDocument,
  deleteAdminFolder,
  generateAdminMachineQr,
  getAdminDocumentSignedUrl,
  getAdminMachine,
  revokeAdminMachineQr,
  updateAdminDocumentFolder,
  updateAdminDocumentSummary,
  updateAdminMachineName,
  type AdminDocument,
  type AdminMachineDetail,
} from "@/admin/adminApi";
import { filesFromDrop } from "@/admin/dropFiles";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  UploadQueueProvider,
  useUploadQueue,
} from "@/components/admin/uploadQueue";

const DOC_DRAG_MIME = "application/x-optipeople-doc-id";

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

  // Auto-poll while any doc is in a non-terminal status. Picks up
  // server-side progress (e.g. an in-flight reprocess kicked off in
  // another tab) without manual refresh, and stops automatically once
  // every doc lands in 'ready' or 'failed'.
  useEffect(() => {
    if (!data) return;
    const inProgress = data.documents.some(
      (d) => d.status !== "ready" && d.status !== "failed",
    );
    if (!inProgress) return;
    const interval = setInterval(() => {
      void reload();
    }, 3000);
    return () => clearInterval(interval);
  }, [data, reload]);

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
    <UploadQueueProvider
      machineId={machineId}
      onChanged={reload}
      processingDocs={data.documents.filter(
        (d) => d.status !== "ready" && d.status !== "failed",
      )}
    >
      <div className="flex flex-col gap-8">
        <Link
          href="/admin/machines"
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Alle maskiner
        </Link>

        <MachineSummary machine={data} onChanged={reload} />

        <MachineQrCard machine={data} onChanged={reload} />

        <UploadCard existingFolders={mergedFolders(data)} />

        <DocumentsTree
          machineId={machineId}
          documents={data.documents}
          explicitFolders={data.folders}
          onChanged={reload}
        />
      </div>
    </UploadQueueProvider>
  );
}

function mergedFolders(detail: AdminMachineDetail): string[] {
  const set = new Set<string>(detail.folders);
  for (const d of detail.documents) {
    if (d.folderPath) set.add(d.folderPath);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
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

  const chatHref = `/?account=${encodeURIComponent(machine.accountId)}&machine=${encodeURIComponent(machine.machineId)}`;

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
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Link
            href={`/admin/machines/${machine.machineId}/conversations`}
            className={cn(
              "inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-hairline)]",
              "bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-foreground)]",
              "transition-colors hover:bg-[var(--color-muted)]",
            )}
            title="Se alle samtaler for denne maskine"
          >
            <History className="h-4 w-4" />
            Samtaler
          </Link>
          <a
            href={chatHref}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-hairline)]",
              "bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-foreground)]",
              "transition-colors hover:bg-[var(--color-muted)]",
            )}
            title="Åbn operatør-chat for denne maskine i ny fane"
          >
            <MessageSquare className="h-4 w-4" />
            Test chat
          </a>
        </div>
      </div>
    </section>
  );
}

function MachineQrCard({
  machine,
  onChanged,
}: {
  machine: AdminMachineDetail;
  onChanged: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"generate" | "revoke" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Origin is window-only; computed lazily on click so SSR doesn't try
  // to read it. The generated link is what an operator scans into.
  const tokenUrl =
    typeof window !== "undefined" && machine.qrToken
      ? `${window.location.origin}/?qr=${encodeURIComponent(machine.qrToken)}`
      : null;

  async function generate() {
    setBusy("generate");
    setErr(null);
    try {
      if (machine.qrToken) {
        const ok = await confirm({
          title: "Regenerér QR-kode?",
          description:
            "Den eksisterende kode bliver ugyldig med det samme. Operatører der scanner gamle stickers vil få en fejl indtil de får ny print.",
          confirmLabel: "Regenerér",
          danger: true,
        });
        if (!ok) {
          setBusy(null);
          return;
        }
      }
      await generateAdminMachineQr(machine.machineId);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fejl");
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    const ok = await confirm({
      title: "Inaktivér QR-kode?",
      description:
        "Operatører kan ikke længere scanne sig ind på maskinen. Du kan altid generere en ny senere.",
      confirmLabel: "Inaktivér",
      danger: true,
    });
    if (!ok) return;
    setBusy("revoke");
    setErr(null);
    try {
      await revokeAdminMachineQr(machine.machineId);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fejl");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!tokenUrl) return;
    try {
      await navigator.clipboard.writeText(tokenUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can fail on insecure contexts; fall back silently.
    }
  }

  const created = machine.qrTokenCreatedAt
    ? DA_DATE.format(new Date(machine.qrTokenCreatedAt))
    : null;

  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-[var(--color-foreground)]" />
            <h2 className="text-[18px] font-semibold tracking-tight text-[var(--color-foreground)]">
              QR-adgang
            </h2>
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
            Operatøren scanner stickeren ved maskinen og lander direkte i
            chatten — uden at logge ind.
          </p>

          {machine.qrToken ? (
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Aktiv
                </span>
                {created && (
                  <span className="text-[12px] text-[var(--color-muted-foreground)]">
                    Genereret {created}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-background)] px-3 py-1.5 text-[12px] text-[var(--color-foreground)]">
                  {tokenUrl ?? ""}
                </code>
                <button
                  type="button"
                  onClick={() => void copy()}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-hairline)]",
                    "bg-[var(--color-surface)] px-3 py-1.5 text-[13px] text-[var(--color-foreground)]",
                    "transition-colors hover:bg-[var(--color-muted)]",
                  )}
                  title="Kopiér link"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      Kopieret
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Kopiér
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <span className="inline-flex rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted-foreground)]">
                Ingen aktiv QR-kode
              </span>
            </div>
          )}

          {err && <p className="mt-2 text-[13px] text-red-600">{err}</p>}
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {machine.qrToken && (
            <Link
              href={`/admin/machines/${machine.machineId}/qr`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-hairline)]",
                "bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-foreground)]",
                "transition-colors hover:bg-[var(--color-muted)]",
              )}
              title="Åbn QR-side med download"
            >
              <Download className="h-4 w-4" />
              Vis & hent
            </Link>
          )}
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy !== null}
            className={cn(
              "inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-hairline)]",
              "bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-foreground)]",
              "transition-colors hover:bg-[var(--color-muted)] disabled:opacity-50",
            )}
          >
            {busy === "generate" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {machine.qrToken ? "Regenerér" : "Generér QR"}
          </button>
          {machine.qrToken && (
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={busy !== null}
              className={cn(
                "inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-hairline)]",
                "bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-red-700",
                "transition-colors hover:bg-red-50 disabled:opacity-50",
              )}
            >
              {busy === "revoke" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              Inaktivér
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const NEW_FOLDER_SENTINEL = "__new__";
const ROOT_FOLDER_SENTINEL = "__root__";

function UploadCard({
  existingFolders,
}: {
  existingFolders: string[];
}) {
  const { enqueueUploads } = useUploadQueue();
  const [dragActive, setDragActive] = useState(false);
  // Folder selector for *picker-based* uploads. Drag-drop uploads use
  // the captured folder paths from the dropped tree and ignore this.
  const [pickerFolder, setPickerFolder] = useState<string>(ROOT_FOLDER_SENTINEL);
  const [newFolderInput, setNewFolderInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function pickerFolderPath(): string | null {
    if (pickerFolder === ROOT_FOLDER_SENTINEL) return null;
    if (pickerFolder === NEW_FOLDER_SENTINEL) {
      const trimmed = newFolderInput.trim();
      return trimmed || null;
    }
    return pickerFolder;
  }

  function handleFileInput(list: FileList | null) {
    if (!list || list.length === 0) return;
    const folderPath = pickerFolderPath();
    const pdfs = Array.from(list)
      .filter(
        (f) =>
          f.type === "application/pdf" ||
          f.name.toLowerCase().endsWith(".pdf"),
      )
      .map((file) => ({ file, folderPath }));
    enqueueUploads(pdfs);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDrop(dt: DataTransfer) {
    const pdfs = await filesFromDrop(dt);
    enqueueUploads(pdfs);
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <h2 className="text-[16px] font-semibold text-[var(--color-foreground)]">
        Upload manualer
      </h2>
      <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
        Træk én eller flere PDF&#39;er — eller en hel mappe — hertil.
        Mappestrukturen bevares. Filerne køres igennem en ad gangen pga.
        embeddings-rate-limits.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-[13px] font-medium text-[var(--color-foreground)]">
          Mappe (kun for filer valgt via knap nedenfor)
          <select
            value={pickerFolder}
            onChange={(e) => setPickerFolder(e.target.value)}
            className={cn(
              "mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--color-hairline)]",
              "bg-[var(--color-background)] px-3 text-[14px] font-normal",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          >
            <option value={ROOT_FOLDER_SENTINEL}>(uden mappe)</option>
            {existingFolders.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value={NEW_FOLDER_SENTINEL}>+ Ny mappe…</option>
          </select>
        </label>
        {pickerFolder === NEW_FOLDER_SENTINEL && (
          <input
            value={newFolderInput}
            onChange={(e) => setNewFolderInput(e.target.value)}
            placeholder="F.eks. Setup/Kalibrering"
            className={cn(
              "h-10 rounded-[var(--radius)] border border-[var(--color-hairline)]",
              "bg-[var(--color-background)] px-3 text-[14px]",
              "placeholder:text-[var(--color-muted-foreground)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          />
        )}
      </div>

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
    </section>
  );
}

// ---- Tree model ----------------------------------------------------------

type FolderTree = {
  name: string;
  path: string;
  documents: AdminDocument[];
  children: FolderTree[];
};

function buildTree(
  documents: AdminDocument[],
  explicitFolders: string[],
): {
  rootDocs: AdminDocument[];
  topFolders: FolderTree[];
} {
  const rootDocs: AdminDocument[] = [];
  const byPath = new Map<string, FolderTree>();

  function getOrCreate(path: string): FolderTree {
    const existing = byPath.get(path);
    if (existing) return existing;
    const segs = path.split("/");
    const node: FolderTree = {
      name: segs[segs.length - 1],
      path,
      documents: [],
      children: [],
    };
    byPath.set(path, node);
    if (segs.length > 1) {
      const parent = getOrCreate(segs.slice(0, -1).join("/"));
      parent.children.push(node);
    }
    return node;
  }

  // Seed nodes for every explicit folder (including empty ones), then
  // attach documents on top. Document paths that aren't in the explicit
  // list still get nodes — defensive against drift.
  for (const path of explicitFolders) {
    if (path) getOrCreate(path);
  }
  for (const doc of documents) {
    if (!doc.folderPath) {
      rootDocs.push(doc);
      continue;
    }
    getOrCreate(doc.folderPath).documents.push(doc);
  }

  const topFolders: FolderTree[] = [];
  for (const node of byPath.values()) {
    if (!node.path.includes("/")) topFolders.push(node);
  }

  function sortRec(folders: FolderTree[]) {
    folders.sort((a, b) => a.name.localeCompare(b.name));
    for (const f of folders) {
      sortRec(f.children);
      f.documents.sort((a, b) => a.title.localeCompare(b.title));
    }
  }
  sortRec(topFolders);
  rootDocs.sort((a, b) => a.title.localeCompare(b.title));

  return { rootDocs, topFolders };
}

// ---- Tree renderer -------------------------------------------------------

function DocumentsTree({
  machineId,
  documents,
  explicitFolders,
  onChanged,
}: {
  machineId: string;
  documents: AdminDocument[];
  explicitFolders: string[];
  onChanged: () => Promise<void>;
}) {
  const { rootDocs, topFolders } = buildTree(documents, explicitFolders);
  const [creating, setCreating] = useState(false);
  const [newFolderInput, setNewFolderInput] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [savingFolder, setSavingFolder] = useState(false);

  async function submitNewFolder() {
    const path = newFolderInput.trim();
    if (!path) return;
    setSavingFolder(true);
    setCreateErr(null);
    try {
      await createAdminFolder(machineId, path);
      setNewFolderInput("");
      setCreating(false);
      await onChanged();
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : "Fejl");
    } finally {
      setSavingFolder(false);
    }
  }
  // Track which folders the operator has manually collapsed. Default is
  // expanded, so newly-uploaded folders show their contents immediately
  // without the user having to re-expand them.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // DnD: a single shared "moving" state so other rows can dim, etc. The
  // actual drop target highlight lives on each folder/root row locally.
  const [movingId, setMovingId] = useState<string | null>(null);

  const moveDoc = useCallback(
    async (docId: string, targetPath: string | null) => {
      const doc = documents.find((d) => d.id === docId);
      if (!doc) return;
      if ((doc.folderPath ?? null) === targetPath) return;
      try {
        await updateAdminDocumentFolder(docId, targetPath);
        await onChanged();
      } catch (err) {
        console.error("move doc failed:", err);
      }
    },
    [documents, onChanged],
  );

  const isEmpty = documents.length === 0 && topFolders.length === 0;

  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-3 bg-[var(--color-muted)] px-4 py-2 text-[12px]">
        {creating ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              autoFocus
              value={newFolderInput}
              onChange={(e) => setNewFolderInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitNewFolder();
                if (e.key === "Escape") {
                  setNewFolderInput("");
                  setCreating(false);
                  setCreateErr(null);
                }
              }}
              placeholder="Sti, f.eks. Setup/Kalibrering"
              disabled={savingFolder}
              className={cn(
                "h-8 max-w-xs flex-1 rounded-[var(--radius)] border border-[var(--color-hairline)]",
                "bg-[var(--color-surface)] px-2 text-[13px] font-normal normal-case",
                "placeholder:text-[var(--color-muted-foreground)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              )}
            />
            <button
              onClick={() => void submitNewFolder()}
              disabled={savingFolder || !newFolderInput.trim()}
              className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
              aria-label="Opret"
            >
              {savingFolder ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewFolderInput("");
                setCreateErr(null);
              }}
              disabled={savingFolder}
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
              aria-label="Annullér"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            {createErr && (
              <span className="ml-2 text-[12px] normal-case text-red-600">
                {createErr}
              </span>
            )}
          </div>
        ) : (
          <>
            <span className="font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Dokumenter
            </span>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] font-medium normal-case text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
            >
              <Folder className="h-3.5 w-3.5" />
              Ny mappe
            </button>
          </>
        )}
      </div>

      {isEmpty ? (
        <div className="p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          Ingen manualer endnu. Upload den første ovenfor — eller opret en
          tom mappe og fyld den senere.
        </div>
      ) : (
        <>
      <div className="grid grid-cols-[2fr_2fr_auto_auto_auto_auto_auto] gap-x-4 bg-[var(--color-muted)] px-4 py-3 text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        <div className="font-medium">Titel</div>
        <div className="font-medium">Beskrivelse</div>
        <div className="font-medium">Status</div>
        <div className="text-right font-medium">Sider</div>
        <div className="text-right font-medium">Størrelse</div>
        <div className="font-medium">Oprettet</div>
        <div></div>
      </div>

      <RootRow
        hasDocs={rootDocs.length > 0}
        onMoveHere={(docId) => void moveDoc(docId, null)}
      />
      {rootDocs.map((d) => (
        <DocumentRow
          key={d.id}
          document={d}
          depth={0}
          onChanged={onChanged}
          onDragStartDoc={() => setMovingId(d.id)}
          onDragEndDoc={() => setMovingId(null)}
          isMoving={movingId === d.id}
        />
      ))}

      {topFolders.map((folder) => (
        <FolderNode
          key={folder.path}
          machineId={machineId}
          folder={folder}
          depth={0}
          collapsed={collapsed}
          toggle={toggle}
          onMoveDoc={moveDoc}
          movingId={movingId}
          setMovingId={setMovingId}
          onChanged={onChanged}
        />
      ))}
        </>
      )}
    </section>
  );
}

function RootRow({
  hasDocs,
  onMoveHere,
}: {
  hasDocs: boolean;
  onMoveHere: (docId: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DOC_DRAG_MIME)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DOC_DRAG_MIME);
        setOver(false);
        if (id) onMoveHere(id);
      }}
      className={cn(
        "border-t border-[var(--color-hairline)]",
        "px-4 py-2 text-[11px] font-medium uppercase tracking-wide",
        "text-[var(--color-muted-foreground)] transition-colors",
        over && "bg-[var(--color-brand)]/5",
      )}
    >
      {hasDocs ? "Rod" : "Rod (træk hertil for at flytte til rod)"}
    </div>
  );
}

function FolderNode({
  machineId,
  folder,
  depth,
  collapsed,
  toggle,
  onMoveDoc,
  movingId,
  setMovingId,
  onChanged,
}: {
  machineId: string;
  folder: FolderTree;
  depth: number;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  onMoveDoc: (docId: string, targetPath: string | null) => Promise<void>;
  movingId: string | null;
  setMovingId: (id: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [over, setOver] = useState(false);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const isOpen = !collapsed.has(folder.path);
  const totalDocs = countDocs(folder);
  const isEmpty =
    folder.documents.length === 0 && folder.children.length === 0;

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isEmpty || deletingFolder) return;
    const ok = await confirm({
      title: `Slet mappen "${folder.name}"?`,
      description: "Mappen er tom. Den fjernes fra strukturen.",
      confirmLabel: "Slet",
      danger: true,
    });
    if (!ok) return;
    setDeletingFolder(true);
    try {
      await deleteAdminFolder(machineId, folder.path);
      await onChanged();
    } catch (err) {
      console.error("delete folder failed:", err);
      setDeletingFolder(false);
    }
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DOC_DRAG_MIME)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DOC_DRAG_MIME);
          setOver(false);
          if (id) void onMoveDoc(id, folder.path);
        }}
        className={cn(
          "group flex cursor-pointer items-center gap-2 border-t border-[var(--color-hairline)]",
          "px-4 py-2.5 text-[14px] transition-colors hover:bg-[var(--color-muted)]/40",
          over && "bg-[var(--color-brand)]/5",
        )}
        style={{ paddingLeft: 16 + depth * 20 }}
        onClick={() => toggle(folder.path)}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)] transition-transform",
            isOpen && "rotate-90",
          )}
        />
        {isOpen ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
        )}
        <span className="font-medium text-[var(--color-foreground)]">
          {folder.name}
        </span>
        <span className="text-[12px] text-[var(--color-muted-foreground)]">
          ({totalDocs})
        </span>
        {isEmpty && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deletingFolder}
            title="Slet tom mappe"
            aria-label="Slet tom mappe"
            className="ml-auto rounded p-1 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:bg-red-50 hover:text-red-700 group-hover:opacity-100 disabled:opacity-40"
          >
            {deletingFolder ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {isOpen && (
        <>
          {folder.documents.map((d) => (
            <DocumentRow
              key={d.id}
              document={d}
              depth={depth + 1}
              onChanged={onChanged}
              onDragStartDoc={() => setMovingId(d.id)}
              onDragEndDoc={() => setMovingId(null)}
              isMoving={movingId === d.id}
            />
          ))}
          {folder.children.map((child) => (
            <FolderNode
              key={child.path}
              machineId={machineId}
              folder={child}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
              onMoveDoc={onMoveDoc}
              movingId={movingId}
              setMovingId={setMovingId}
              onChanged={onChanged}
            />
          ))}
        </>
      )}
    </>
  );
}

function countDocs(folder: FolderTree): number {
  let n = folder.documents.length;
  for (const c of folder.children) n += countDocs(c);
  return n;
}

function DocumentRow({
  document,
  depth,
  onChanged,
  onDragStartDoc,
  onDragEndDoc,
  isMoving,
}: {
  document: AdminDocument;
  depth: number;
  onChanged: () => Promise<void>;
  onDragStartDoc: () => void;
  onDragEndDoc: () => void;
  isMoving: boolean;
}) {
  const confirm = useConfirm();
  const { enqueueReprocess } = useUploadQueue();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(document.summary);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reprocess() {
    const ok = await confirm({
      title: `Kør "${document.title}" igennem Claude OCR?`,
      description:
        "Eksisterende chunks slettes og dokumentet behandles igen via vision. Det kan tage et minut og forbruger Claude tokens. Tidligere svar i samtaler påvirkes ikke, men nye søgninger vil bruge det nye indhold.",
      confirmLabel: "Reprocesser",
    });
    if (!ok) return;
    enqueueReprocess({
      documentId: document.id,
      documentTitle: document.title,
      fileSize: document.byteSize,
    });
  }

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
    <div
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(DOC_DRAG_MIME, document.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStartDoc();
      }}
      onDragEnd={onDragEndDoc}
      className={cn(
        "grid grid-cols-[2fr_2fr_auto_auto_auto_auto_auto] items-center gap-x-4",
        "border-t border-[var(--color-hairline)] px-4 py-3 text-[14px]",
        "transition-opacity",
        isMoving && "opacity-40",
      )}
      style={{ paddingLeft: 16 + depth * 20 }}
    >
      <div className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--color-foreground)]">
        <GripVertical
          className="h-4 w-4 shrink-0 cursor-grab text-[var(--color-muted-foreground)]/40 hover:text-[var(--color-muted-foreground)]"
          aria-label="Træk for at flytte"
        />
        <span className="truncate">{document.title}</span>
        {document.extractionSource === "claude-ocr" && (
          <span title="Tekst udvundet med Claude vision (OCR)">
            <ScanEye
              aria-label="Claude vision OCR"
              className="h-3.5 w-3.5 shrink-0 text-violet-600"
            />
          </span>
        )}
        {document.sourceType === "feedback" && (
          <span title="Auto-promoveret fra operatør-feedback (markeret som virkende)">
            <MessageSquareQuote
              aria-label="Operatør-erfaring"
              className="h-3.5 w-3.5 shrink-0 text-emerald-600"
            />
          </span>
        )}
      </div>

      <div className="min-w-0 text-[var(--color-foreground)]">
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
              className="rounded p-1 text-emerald-700 hover:bg-emerald-50"
              aria-label="Gem"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={() => {
                setDraft(document.summary);
                setEditing(false);
              }}
              disabled={saving}
              className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
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
      </div>

      <div>
        <span
          className={cn(
            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
            badge.tone,
          )}
        >
          {badge.label}
        </span>
      </div>

      <div className="text-right tabular-nums text-[var(--color-foreground)]">
        {document.pageCount ?? "—"}
      </div>

      <div className="text-right tabular-nums text-[var(--color-muted-foreground)]">
        {formatBytes(document.byteSize)}
      </div>

      <div className="text-[var(--color-muted-foreground)]">
        {DA_DATE.format(new Date(document.createdAt))}
      </div>

      <div className="flex items-center justify-end gap-0.5">
        {document.sourceType !== "feedback" && (
          <>
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
              onClick={() => void reprocess()}
              title="Kør igennem Claude OCR igen — kører i den fælles kø"
              aria-label="Reprocesser med OCR"
              className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-violet-50 hover:text-violet-700"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </>
        )}
        <button
          onClick={() => void remove()}
          disabled={deleting}
          title={
            document.sourceType === "feedback"
              ? "Demoter — fjern operatør-erfaringen fra KB"
              : "Slet dokument"
          }
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
    </div>
  );
}
