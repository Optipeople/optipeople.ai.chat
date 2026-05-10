"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteAdminDocument,
  getAdminMachine,
  updateAdminDocumentSummary,
  updateAdminMachineName,
  uploadAdminDocument,
  type AdminDocument,
  type AdminMachineDetail,
} from "@/admin/adminApi";

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

function UploadCard({
  machineId,
  onUploaded,
}: {
  machineId: string;
  onUploaded: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(list: FileList | null) {
    setErr(null);
    if (!list || list.length === 0) return;
    const f = list[0];
    if (f.type && f.type !== "application/pdf") {
      setErr("Kun PDF-filer er understøttet.");
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (!file || uploading) return;
    setUploading(true);
    setProgress(0);
    setErr(null);
    try {
      await uploadAdminDocument({
        machineId,
        file,
        summary: summary.trim() || undefined,
        onProgress: (loaded, total) => {
          setProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
      });
      setFile(null);
      setSummary("");
      setProgress(0);
      if (inputRef.current) inputRef.current.value = "";
      await onUploaded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload fejlede");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <h2 className="text-[16px] font-semibold text-[var(--color-foreground)]">
        Upload manual
      </h2>
      <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
        PDF op til 100 MB. Beskrivelsen ses af AI&#39;en når den vælger
        manualer — skriv 1 linje om hvad denne handler om.
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
          handleFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="h-5 w-5 text-[var(--color-muted-foreground)]" />
        {file ? (
          <p className="text-[14px] text-[var(--color-foreground)]">
            <span className="font-medium">{file.name}</span>{" "}
            <span className="text-[var(--color-muted-foreground)]">
              ({formatBytes(file.size)})
            </span>
          </p>
        ) : (
          <p className="text-[14px] text-[var(--color-muted-foreground)]">
            Træk en PDF hertil, eller{" "}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-medium text-[var(--color-brand)] hover:underline"
            >
              vælg en fil
            </button>
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <label className="mt-4 block text-[13px] font-medium text-[var(--color-foreground)]">
        Beskrivelse (valgfri)
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="F.eks. Procedure for alarm 731"
          disabled={uploading}
          className={cn(
            "mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--color-hairline)]",
            "bg-[var(--color-background)] px-3 text-[14px] font-normal",
            "placeholder:text-[var(--color-muted-foreground)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          )}
        />
      </label>

      {err && (
        <p className="mt-3 text-[13px] text-red-600">{err}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="text-[13px] text-[var(--color-muted-foreground)]">
          {uploading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progress < 100
                ? `Uploader ${progress}%…`
                : "Behandler PDF og embedder…"}
            </span>
          ) : (
            "Embedding kan tage et minut eller to."
          )}
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!file || uploading}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-[var(--radius)] px-4",
            "text-[14px] font-medium text-white transition-colors",
            "bg-[var(--color-brand)] hover:opacity-90",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Upload
        </button>
      </div>
    </section>
  );
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(document.summary);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    if (
      !window.confirm(
        `Slet "${document.title}"? Embeddingerne fjernes også. Kan ikke fortrydes.`,
      )
    ) {
      return;
    }
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
        {document.title}
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
        <button
          onClick={() => void remove()}
          disabled={deleting}
          className="rounded p-1.5 text-[var(--color-muted-foreground)] hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
          aria-label="Slet"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </td>
    </tr>
  );
}
