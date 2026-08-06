"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  GripVertical,
  History,
  Image as ImageIcon,
  Info,
  MessageSquare,
  MessageSquareQuote,
  Pencil,
  QrCode,
  RefreshCw,
  ScanEye,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
  createAdminFolder,
  deleteAdminDocument,
  deleteAdminFolder,
  deleteAdminMachine,
  generateAdminMachineQr,
  getAdminDocumentSignedUrl,
  getAdminMachine,
  revokeAdminMachineQr,
  updateAdminDocumentFolder,
  updateAdminDocumentOperatorVisible,
  updateAdminDocumentSummary,
  updateAdminMachineName,
  type AdminDocument,
  type AdminMachineDetail,
} from "@/admin/adminApi";
import { classifyFile, filesFromDrop } from "@/admin/dropFiles";
import { getAccounts } from "@/auth/accountsApi";
import { getMachinesForAccount } from "@/auth/machinesApi";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button, buttonClasses } from "@/components/ui/button";
import { Tag, type TagVariant } from "@/components/ui/tag";
import { Select } from "@/components/ui/select";
import {
  UploadQueuePanel,
  UploadQueueProvider,
  useUploadQueue,
} from "@/components/admin/uploadQueue";
import { MachineEscalationCard } from "@/components/admin/MachineEscalationCard";
import { McpStatusBadge } from "@/components/admin/McpStatusBadge";
import { AutoOrganizeDialog } from "@/components/admin/AutoOrganizeDialog";

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

function statusBadge(
  status: string,
  t: (key: string) => string,
): { label: string; variant: TagVariant } {
  switch (status) {
    case "ready":
      return { label: t("statusReady"), variant: "positive" };
    case "embedding":
    case "extracting":
    case "uploaded":
      return { label: t("statusProcessing"), variant: "warning" };
    case "failed":
      return { label: t("statusFailed"), variant: "issue" };
    default:
      return { label: status, variant: "default" };
  }
}

export function MachineDetail({ machineId }: { machineId: string }) {
  const t = useTranslations("admin.machineDetail");
  const tc = useTranslations("common");
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
        setError(err instanceof Error ? err.message : tc("unknownError"));
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
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[14px] text-[var(--ds-red)]">
        {error ?? t("fetchFailed")}
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
      <div className="flex flex-col gap-5 pb-24 sm:gap-8 sm:pb-32">
        <UploadCard existingFolders={mergedFolders(data)} />

        <UploadQueuePanel />

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

// Settings tab for /admin/machines/[id]/settings. Fetches the machine
// once (no polling — none of these cards reflect doc-processing state)
// and renders the name/QR/escalation cards that used to live on the
// main machine page.
export function MachineSettings({ machineId }: { machineId: string }) {
  const t = useTranslations("admin.machineDetail");
  const tc = useTranslations("common");
  const [data, setData] = useState<AdminMachineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const detail = await getAdminMachine(machineId);
    setData(detail);
  }, [machineId]);

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
        setError(err instanceof Error ? err.message : tc("unknownError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId, tc]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[14px] text-[var(--ds-red)]">
        {error ?? t("fetchFailed")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-8">
      <MachineSummary machine={data} onChanged={reload} />
      <MachineQrCard machine={data} onChanged={reload} />
      <MachineEscalationCard accountId={data.accountId} />
    </div>
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
  const t = useTranslations("admin.machineDetail");
  const router = useRouter();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(machine.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Real Optipeople-registered names for the machine + account.
  // Best-effort: silently fall back to "—" if the Optipeople API is
  // unreachable or the IDs no longer exist there.
  const [accountName, setAccountName] = useState<string | null>(null);
  const [machineName, setMachineName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [accounts, machines] = await Promise.all([
          getAccounts(),
          getMachinesForAccount(machine.accountId),
        ]);
        if (cancelled) return;
        setAccountName(
          accounts.find((a) => a.id === machine.accountId)?.name ?? null,
        );
        setMachineName(
          machines.find((m) => m.id === machine.machineId)?.name ?? null,
        );
      } catch {
        // Operator-role admins (or transient API errors) — just leave names blank.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [machine.accountId, machine.machineId]);

  async function save() {
    if (!draft.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await updateAdminMachineName(machine.machineId, draft.trim());
      await onChanged();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("genericError"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const label = machine.displayName ?? machine.machineId;
    const ok = await confirm({
      title: t("deleteConfirmTitle", { label }),
      description: t("deleteConfirmBody"),
      confirmLabel: t("deleteConfirmLabel"),
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    setErr(null);
    try {
      await deleteAdminMachine(machine.machineId);
      router.push("/admin/machines");
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("genericError"));
      setDeleting(false);
    }
  }

  const chatHref = `/?account=${encodeURIComponent(machine.accountId)}&machine=${encodeURIComponent(machine.machineId)}`;

  return (
    <section className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
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
                  "h-10 flex-1 min-w-0 rounded-[4px] border border-[var(--color-hairline)]",
                  "bg-[var(--color-background)] px-3 text-[18px] font-semibold sm:text-[20px]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                )}
              />
              <button
                onClick={() => void save()}
                disabled={saving || !draft.trim()}
                className="rounded-[4px] p-2 text-[var(--ds-green)] hover:bg-[var(--ds-tag-green-light)] disabled:opacity-40"
                aria-label={t("saveAria")}
              >
                {saving ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  setDraft(machine.displayName ?? "");
                  setEditing(false);
                  setErr(null);
                }}
                disabled={saving}
                className="rounded-[4px] p-2 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
                aria-label={t("cancelAria")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="group flex w-full items-center gap-2 text-left"
            >
              <h1 className="min-w-0 truncate text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
                {machine.displayName ?? t("noName")}
              </h1>
              <Pencil className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0 sm:flex-nowrap">
          <Link
            href={`/admin/machines/${machine.machineId}?section=conversations`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
            title={t("conversationsTitle")}
          >
            <History className="mr-1.5 h-4 w-4" />
            {t("conversationsBtn")}
          </Link>
          <Link
            href={`/admin/machines/${machine.machineId}?section=escalations`}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
            title={t("escalationsTitle")}
          >
            <Wrench className="mr-1.5 h-4 w-4" />
            {t("escalationsBtn")}
          </Link>
          <a
            href={chatHref}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
            title={t("testChatTitle")}
          >
            <MessageSquare className="mr-1.5 h-4 w-4" />
            {t("testChat")}
          </a>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void remove()}
            disabled={deleting}
            title={t("deleteMachineTitle")}
          >
            {deleting ? (
              <Spinner className="mr-1.5 h-4 w-4" />
            ) : (
              <Trash2 className="mr-1.5 h-4 w-4" />
            )}
            {t("deleteMachine")}
          </Button>
        </div>
      </div>
      {err && (
        <p className="mt-2 text-[13px] text-[var(--ds-red)]">{err}</p>
      )}
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
            {t("machineName")}
            <span
              title={t("machineNameTooltip")}
              aria-label={t("machineNameSourceAria")}
              className="inline-flex cursor-help"
            >
              <Info className="h-3 w-3 text-[var(--color-muted-foreground)]/60" />
            </span>
          </dt>
          <dd className="min-w-0 break-words text-[var(--color-foreground)]">{machineName ?? "—"}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
            {t("accountName")}
            <span
              title={t("accountNameTooltip")}
              aria-label={t("machineNameSourceAria")}
              className="inline-flex cursor-help"
            >
              <Info className="h-3 w-3 text-[var(--color-muted-foreground)]/60" />
            </span>
          </dt>
          <dd className="min-w-0 break-words text-[var(--color-foreground)]">{accountName ?? "—"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">{t("machineIdLabel")}</dt>
          <dd className="min-w-0 break-all font-mono text-[var(--color-foreground)]">{machine.machineId}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">{t("accountIdLabel")}</dt>
          <dd className="min-w-0 break-all font-mono text-[var(--color-foreground)]">{machine.accountId}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">{t("documentsLabel")}</dt>
          <dd className="text-[var(--color-foreground)]">{machine.documents.length}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="text-[var(--color-muted-foreground)]">{t("updatedLabel")}</dt>
          <dd className="text-[var(--color-foreground)]">
            {DA_DATE.format(new Date(machine.updatedAt))}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt className="text-[var(--color-muted-foreground)]">MCP</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2 text-[var(--color-foreground)]">
            {machine.mcp ? (
              <>
                <McpStatusBadge status={machine.mcp.status} />
                {machine.mcp.label ? (
                  <span className="text-[var(--color-muted-foreground)]">
                    {machine.mcp.label}
                  </span>
                ) : null}
                <a
                  href="/admin/mcp"
                  className="text-[12px] text-[var(--color-muted-foreground)] underline hover:text-[var(--color-foreground)]"
                >
                  Manage
                </a>
              </>
            ) : (
              <>
                <McpStatusBadge status="unconfigured" />
                <a
                  href="/admin/mcp"
                  className="text-[12px] text-[var(--color-muted-foreground)] underline hover:text-[var(--color-foreground)]"
                >
                  Set up
                </a>
              </>
            )}
          </dd>
        </div>
      </dl>
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
  const t = useTranslations("admin.machineDetail");
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
          title: t("qrRegenConfirmTitle"),
          description: t("qrRegenConfirmBody"),
          confirmLabel: t("qrRegenConfirmLabel"),
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
      setErr(e instanceof Error ? e.message : t("genericError"));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    const ok = await confirm({
      title: t("qrRevokeConfirmTitle"),
      description: t("qrRevokeConfirmBody"),
      confirmLabel: t("qrRevokeConfirmLabel"),
      danger: true,
    });
    if (!ok) return;
    setBusy("revoke");
    setErr(null);
    try {
      await revokeAdminMachineQr(machine.machineId);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("genericError"));
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
    <section className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 shrink-0 text-[var(--color-foreground)]" />
            <h2 className="text-[17px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[18px]">
              {t("qrHeading")}
            </h2>
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
            {t("qrDescription")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:shrink-0 sm:flex-nowrap">
          {machine.qrToken && (
            <Link
              href={`/admin/machines/${machine.machineId}/qr`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              title={t("qrViewDownloadTitle")}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {t("qrViewDownload")}
            </Link>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void generate()}
            disabled={busy !== null}
          >
            {busy === "generate" ? (
              <Spinner className="mr-1.5 h-4 w-4" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            {machine.qrToken ? t("qrRegenerate") : t("qrGenerate")}
          </Button>
          {machine.qrToken && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void revoke()}
              disabled={busy !== null}
            >
              {busy === "revoke" ? (
                <Spinner className="mr-1.5 h-4 w-4" />
              ) : (
                <X className="mr-1.5 h-4 w-4" />
              )}
              {t("qrRevoke")}
            </Button>
          )}
        </div>
      </div>

      {machine.qrToken ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Tag variant="positive" size="small">
              {t("qrActive")}
            </Tag>
            {created && (
              <span className="text-[12px] text-[var(--color-muted-foreground)]">
                {t("qrGeneratedAt", { date: created })}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-background)] px-3 py-1.5 text-[12px] text-[var(--color-foreground)]">
              {tokenUrl ?? ""}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-[var(--color-hairline)]",
                "bg-[var(--color-surface)] px-3 py-1.5 text-[13px] text-[var(--color-foreground)]",
                "transition-colors hover:bg-[var(--color-muted)]",
              )}
              title={t("qrCopyTitle")}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[var(--ds-green)]" />
                  {t("qrCopied")}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  {t("qrCopy")}
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <Tag variant="default" size="small">
            {t("qrInactive")}
          </Tag>
        </div>
      )}

      {err && <p className="mt-2 text-[13px] text-[var(--ds-red)]">{err}</p>}
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
  const t = useTranslations("admin.machineDetail");
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
    const files = Array.from(list).flatMap((file) => {
      const kind = classifyFile(file);
      return kind ? [{ file, folderPath, kind }] : [];
    });
    enqueueUploads(files);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDrop(dt: DataTransfer) {
    const files = await filesFromDrop(dt);
    enqueueUploads(files);
  }

  return (
    <section
      id="upload"
      className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:p-6 scroll-mt-24"
    >
      <h2 className="text-[16px] font-semibold text-[var(--color-foreground)]">
        {t("uploadHeading")}
      </h2>
      <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
        {t("uploadDescription")}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Select
          label={t("folderLabel")}
          size="medium"
          value={pickerFolder}
          onValueChange={setPickerFolder}
        >
          <option value={ROOT_FOLDER_SENTINEL}>{t("folderRoot")}</option>
          {existingFolders.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value={NEW_FOLDER_SENTINEL}>{t("folderNew")}</option>
        </Select>
        {pickerFolder === NEW_FOLDER_SENTINEL && (
          <input
            value={newFolderInput}
            onChange={(e) => setNewFolderInput(e.target.value)}
            placeholder={t("folderNewPlaceholder")}
            className={cn(
              "h-10 rounded-[4px] border border-[var(--color-hairline)]",
              "bg-[var(--color-background)] px-3 text-[14px]",
              "placeholder:text-[var(--color-muted-foreground)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          />
        )}
      </div>

      <div
        className={cn(
          "mt-4 flex flex-col items-center justify-center gap-2 rounded-[4px]",
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
          {t("dropPrefix")}{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-[var(--color-brand)] hover:underline"
          >
            {t("dropPickFiles")}
          </button>
        </p>
        <input
          ref={inputRef}
          type="file"
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
  const t = useTranslations("admin.machineDetail");
  const confirm = useConfirm();
  const { rootDocs, topFolders } = buildTree(documents, explicitFolders);
  const [creating, setCreating] = useState(false);
  const [newFolderInput, setNewFolderInput] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [savingFolder, setSavingFolder] = useState(false);
  const [autoOrganizeOpen, setAutoOrganizeOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkVisibility, setBulkVisibility] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  // Drop selections that no longer correspond to a visible document
  // (e.g. after a refresh or a successful delete). Reconciles local
  // selection set with the externally-fetched documents list.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(documents.map((d) => d.id));
      const next = new Set<string>();
      for (const id of prev) if (valid.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [documents]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allDocIds = documents.map((d) => d.id);
  const allSelected =
    allDocIds.length > 0 && allDocIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    setSelected((prev) =>
      prev.size === allDocIds.length ? new Set() : new Set(allDocIds),
    );
  }

  async function bulkSetVisibility(visible: boolean) {
    if (selected.size === 0) return;
    setBulkVisibility(true);
    setBulkErr(null);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((id) => updateAdminDocumentOperatorVisible(id, visible)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    try {
      await onChanged();
    } finally {
      setBulkVisibility(false);
    }
    if (failed > 0) {
      setBulkErr(t("bulkVisibilityFailed", { failed, total: ids.length }));
    }
  }

  // Mixed-state aware: if any selected doc is hidden, the bulk action
  // shows them; otherwise it hides them. Read off the current documents
  // snapshot so the label updates as the selection or data changes.
  const bulkVisibilityAction: "show" | "hide" = (() => {
    if (selected.size === 0) return "show";
    const anyHidden = documents.some(
      (d) => selected.has(d.id) && !d.operatorVisible,
    );
    return anyHidden ? "show" : "hide";
  })();

  async function bulkDelete() {
    if (selected.size === 0) return;
    const n = selected.size;
    const ok = await confirm({
      title:
        n === 1
          ? t("bulkDeleteConfirmTitleOne", { count: n })
          : t("bulkDeleteConfirmTitle", { count: n }),
      description: t("bulkDeleteConfirmBody"),
      confirmLabel: t("bulkDeleteConfirmLabel"),
      danger: true,
    });
    if (!ok) return;
    setBulkDeleting(true);
    setBulkErr(null);
    const ids = Array.from(selected);
    const results = await Promise.allSettled(
      ids.map((id) => deleteAdminDocument(id)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    setSelected(new Set());
    try {
      await onChanged();
    } finally {
      setBulkDeleting(false);
    }
    if (failed > 0) {
      setBulkErr(t("bulkDeleteFailed", { failed, total: ids.length }));
    }
  }

  // Show the auto-organize button when there's at least one ready doc to
  // think about. With zero docs there's nothing to suggest moves for.
  const canAutoOrganize = documents.some((d) => d.status === "ready");

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
      setCreateErr(e instanceof Error ? e.message : t("genericError"));
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

  function cancelCreate() {
    setCreating(false);
    setNewFolderInput("");
    setCreateErr(null);
  }

  return (
    <section className="overflow-hidden rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="flex flex-col gap-2 bg-[var(--color-muted)] px-3 py-2 text-[12px] sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
        <div className="flex items-center gap-3">
          <span className="font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {t("documents")}
          </span>
          {selected.size > 0 && (
            <span className="normal-case text-[12px] text-[var(--color-muted-foreground)]">
              {t("selectedCount", { count: selected.size })}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={bulkDeleting || bulkVisibility}
                className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] font-medium normal-case text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
              >
                {t("clearSelection")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void bulkSetVisibility(bulkVisibilityAction === "show")
                }
                disabled={bulkDeleting || bulkVisibility}
                className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] font-medium normal-case text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
              >
                {bulkVisibility ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : bulkVisibilityAction === "show" ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                {bulkVisibilityAction === "show"
                  ? t("bulkShowOperators", { count: selected.size })
                  : t("bulkHideOperators", { count: selected.size })}
              </button>
              <button
                type="button"
                onClick={() => void bulkDelete()}
                disabled={bulkDeleting || bulkVisibility}
                className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--ds-red)]/30 bg-[var(--ds-red-bg)] px-2.5 py-1 text-[12px] font-medium normal-case text-[var(--ds-red)] hover:bg-[var(--ds-red)]/10 disabled:opacity-50"
              >
                {bulkDeleting ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t("deleteN", { count: selected.size })}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setAutoOrganizeOpen(true)}
            disabled={!canAutoOrganize}
            title={t("autoOrganizeTitle")}
            className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] font-medium normal-case text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" />
            {t("autoOrganize")}
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={creating}
            className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-1 text-[12px] font-medium normal-case text-[var(--color-foreground)] hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            <Folder className="h-3.5 w-3.5" />
            {t("newFolder")}
          </button>
        </div>
      </div>
      {bulkErr && (
        <div className="border-t border-[var(--color-hairline)] bg-[var(--ds-red-bg)] px-4 py-2 text-[12px] text-[var(--ds-red)]">
          {bulkErr}
        </div>
      )}

      {autoOrganizeOpen && (
        <AutoOrganizeDialog
          machineId={machineId}
          onClose={() => setAutoOrganizeOpen(false)}
          onApplied={onChanged}
        />
      )}

      {isEmpty && !creating ? (
        <div className="p-10 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {t("emptyTree")}
        </div>
      ) : (
        <div className="overflow-x-auto">
        <div className="grid min-w-[860px] grid-cols-[auto_2fr_2fr_auto_auto_auto_auto_auto_auto]">
      <div className="col-span-full grid grid-cols-subgrid items-center gap-x-4 bg-[var(--color-muted)] px-4 py-3 text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        <input
          type="checkbox"
          aria-label={allSelected ? t("deselectAll") : t("selectAll")}
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={toggleAll}
          disabled={allDocIds.length === 0}
          className="h-4 w-4 cursor-pointer accent-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-40"
        />
        <div className="font-medium">{t("colTitle")}</div>
        <div className="font-medium">{t("colDescription")}</div>
        <div className="font-medium">{t("colStatus")}</div>
        <div className="text-right font-medium">{t("colPages")}</div>
        <div className="text-right font-medium">{t("colSize")}</div>
        <div className="font-medium">{t("colCreated")}</div>
        <div
          className="text-center font-medium"
          title={t("colOperatorVisibleTitle")}
        >
          {t("colOperatorVisible")}
        </div>
        <div></div>
      </div>

      {creating && (
        <NewFolderRow
          value={newFolderInput}
          onChange={setNewFolderInput}
          onSubmit={submitNewFolder}
          onCancel={cancelCreate}
          saving={savingFolder}
          error={createErr}
        />
      )}

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
          selected={selected.has(d.id)}
          onToggleSelected={toggleSelected}
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
          selected={selected}
          onToggleSelected={toggleSelected}
        />
      ))}
        </div>
        </div>
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
  const t = useTranslations("admin.machineDetail");
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
        "col-span-full border-t border-[var(--color-hairline)]",
        "px-4 py-2 text-[11px] font-medium uppercase tracking-wide",
        "text-[var(--color-muted-foreground)] transition-colors",
        over && "bg-[var(--color-brand)]/5",
      )}
    >
      {hasDocs ? t("root") : t("rootDrop")}
    </div>
  );
}

function NewFolderRow({
  value,
  onChange,
  onSubmit,
  onCancel,
  saving,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const t = useTranslations("admin.machineDetail");
  return (
    <div
      className={cn(
        "col-span-full flex items-center gap-2 border-t border-[var(--color-hairline)]",
        "bg-[var(--color-brand)]/5 px-4 py-2 text-[14px]",
      )}
      style={{ paddingLeft: 16 }}
    >
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
      <Folder className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={t("newFolderPlaceholder")}
        disabled={saving}
        className={cn(
          "h-7 max-w-sm flex-1 rounded-[4px] border border-[var(--color-hairline)]",
          "bg-[var(--color-surface)] px-2 text-[13px] font-medium normal-case",
          "placeholder:font-normal placeholder:text-[var(--color-muted-foreground)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        )}
      />
      {error && (
        <span className="text-[12px] normal-case text-[var(--ds-red)]">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving || !value.trim()}
        className="ml-auto rounded p-1 text-[var(--ds-green)] hover:bg-[var(--ds-tag-green-light)] disabled:opacity-40"
        aria-label={t("createFolderAria")}
      >
        {saving ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)]"
        aria-label={t("cancelAria")}
      >
        <X className="h-3.5 w-3.5" />
      </button>
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
  selected,
  onToggleSelected,
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
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
}) {
  const t = useTranslations("admin.machineDetail");
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
      title: t("deleteFolderConfirmTitle", { name: folder.name }),
      description: t("deleteFolderConfirmBody"),
      confirmLabel: t("deleteFolderConfirmLabel"),
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
          "group col-span-full flex cursor-pointer items-center gap-2 border-t border-[var(--color-hairline)]",
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
            title={t("deleteEmptyFolderTitle")}
            aria-label={t("deleteEmptyFolderAria")}
            className="ml-auto rounded p-1 text-[var(--color-muted-foreground)] opacity-0 transition-opacity hover:bg-[var(--ds-red-bg)] hover:text-[var(--ds-red)] group-hover:opacity-100 disabled:opacity-40"
          >
            {deletingFolder ? (
              <Spinner className="h-3.5 w-3.5" />
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
              selected={selected.has(d.id)}
              onToggleSelected={onToggleSelected}
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
              selected={selected}
              onToggleSelected={onToggleSelected}
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
  selected,
  onToggleSelected,
}: {
  document: AdminDocument;
  depth: number;
  onChanged: () => Promise<void>;
  onDragStartDoc: () => void;
  onDragEndDoc: () => void;
  isMoving: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}) {
  const t = useTranslations("admin.machineDetail");
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
      title: t("reprocessConfirmTitle", { title: document.title }),
      description: t("reprocessConfirmBody"),
      confirmLabel: t("reprocessConfirmLabel"),
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
        setErr(t("popupBlocked"));
        return;
      }
      w.opener = null;
      w.location.href = url;
    } catch (e) {
      w?.close();
      setErr(e instanceof Error ? e.message : t("openFileFailed"));
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
      setErr(e instanceof Error ? e.message : t("downloadFileFailed"));
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
      setErr(e instanceof Error ? e.message : t("genericError"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: t("deleteDocConfirmTitle", { title: document.title }),
      description: t("deleteDocConfirmBody"),
      confirmLabel: t("deleteDocConfirmLabel"),
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    setErr(null);
    try {
      await deleteAdminDocument(document.id);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("genericError"));
      setDeleting(false);
    }
  }

  const badge = statusBadge(document.status, t);

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
        "col-span-full grid grid-cols-subgrid items-center gap-x-4",
        "border-t border-[var(--color-hairline)] px-4 py-3 text-[14px]",
        "transition-opacity",
        isMoving && "opacity-40",
        selected && "bg-[var(--color-brand)]/5",
      )}
      style={{ paddingLeft: 16 + depth * 20 }}
    >
      <input
        type="checkbox"
        aria-label={t("selectDocAria", { title: document.title })}
        checked={selected}
        onChange={() => onToggleSelected(document.id)}
        // Stop drag/click bubbling so the checkbox doesn't trigger the
        // row drag handle or expand interactions.
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
        className="h-4 w-4 cursor-pointer accent-[var(--color-brand)]"
      />
      <div className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--color-foreground)]">
        <GripVertical
          className="h-4 w-4 shrink-0 cursor-grab text-[var(--color-muted-foreground)]/40 hover:text-[var(--color-muted-foreground)]"
          aria-label={t("dragToMoveAria")}
        />
        <span className="truncate">{document.title}</span>
        {document.sourceType === "image" && (
          <span title={t("imageTitle")}>
            <ImageIcon
              aria-label={t("imageAria")}
              className="h-3.5 w-3.5 shrink-0 text-[var(--color-brand)]"
            />
          </span>
        )}
        {document.extractionSource === "claude-ocr" && (
          <span title={t("ocrTitle")}>
            <ScanEye
              aria-label={t("ocrAria")}
              className="h-3.5 w-3.5 shrink-0 text-violet-600"
            />
          </span>
        )}
        {document.sourceType === "feedback" && (
          <span title={t("feedbackTitle")}>
            <MessageSquareQuote
              aria-label={t("feedbackAria")}
              className="h-3.5 w-3.5 shrink-0 text-[var(--ds-green)]"
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
                "h-8 flex-1 rounded-[4px] border border-[var(--color-hairline)]",
                "bg-[var(--color-background)] px-2 text-[14px]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              )}
            />
            <button
              onClick={() => void saveSummary()}
              disabled={saving}
              className="rounded p-1 text-[var(--ds-green)] hover:bg-[var(--ds-tag-green-light)]"
              aria-label={t("saveAria")}
            >
              {saving ? (
                <Spinner className="h-3.5 w-3.5" />
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
              aria-label={t("cancelAria")}
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
        {err && <p className="mt-1 text-[12px] text-[var(--ds-red)]">{err}</p>}
      </div>

      <div>
        <Tag variant={badge.variant} size="small">
          {badge.label}
        </Tag>
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

      <div className="flex items-center justify-center">
        <OperatorVisibleToggle document={document} onChanged={onChanged} />
      </div>

      <div className="flex items-center justify-end gap-0.5">
        {document.sourceType !== "feedback" && (
          <>
            <button
              onClick={() => void viewOriginal()}
              disabled={opening}
              title={t("openOriginalTitle")}
              aria-label={t("openOriginalAria")}
              className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-40"
            >
              {opening ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => void downloadOriginal()}
              disabled={downloading}
              title={t("downloadOriginalTitle")}
              aria-label={t("downloadOriginalAria")}
              className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-40"
            >
              {downloading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
            {document.sourceType === "pdf" && (
              <button
                onClick={() => void reprocess()}
                title={t("reprocessTitle")}
                aria-label={t("reprocessAria")}
                className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-violet-50 hover:text-violet-700"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            )}
          </>
        )}
        <button
          onClick={() => void remove()}
          disabled={deleting}
          title={
            document.sourceType === "feedback"
              ? t("deleteFeedbackTitle")
              : t("deleteDocTitle")
          }
          aria-label={t("deleteDocAria")}
          className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--ds-red-bg)] hover:text-[var(--ds-red)] disabled:opacity-40"
        >
          {deleting ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

function OperatorVisibleToggle({
  document,
  onChanged,
}: {
  document: AdminDocument;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("admin.machineDetail");
  const [saving, setSaving] = useState(false);
  // Optimistic local state — the row only re-renders with fresh server
  // data after `onChanged` resolves, so we mirror the click immediately
  // and let the refetch correct it if the PATCH fails.
  const [localVisible, setLocalVisible] = useState(document.operatorVisible);
  useEffect(() => {
    setLocalVisible(document.operatorVisible);
  }, [document.operatorVisible]);

  async function toggle() {
    if (saving) return;
    const next = !localVisible;
    setSaving(true);
    setLocalVisible(next);
    try {
      await updateAdminDocumentOperatorVisible(document.id, next);
      await onChanged();
    } catch {
      setLocalVisible(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={localVisible}
      aria-label={
        localVisible
          ? t("operatorVisibleHideAria", { title: document.title })
          : t("operatorVisibleShowAria", { title: document.title })
      }
      title={
        localVisible ? t("operatorVisibleHideTitle") : t("operatorVisibleShowTitle")
      }
      onClick={() => void toggle()}
      disabled={saving}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        "disabled:opacity-50",
        localVisible
          ? "bg-[var(--color-brand)]"
          : "bg-[var(--color-muted-foreground)]/30",
      )}
    >
      <span
        className={cn(
          "inline-flex h-4 w-4 transform items-center justify-center rounded-full bg-white shadow-sm transition-transform",
          localVisible ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      >
        {saving && (
          <Spinner className="h-2.5 w-2.5" />
        )}
      </span>
    </button>
  );
}
