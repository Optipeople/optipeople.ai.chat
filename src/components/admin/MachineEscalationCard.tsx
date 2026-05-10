"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, Phone, Trash2, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  clearAdminEscalationTarget,
  getAdminEscalationTarget,
  saveAdminEscalationTarget,
  type AdminEscalationTarget,
} from "@/admin/adminApi";

type Channel = AdminEscalationTarget["channel"];

const CHANNEL_LABEL: Record<Channel, string> = {
  phone: "Telefon",
  email: "E-mail",
  service_ticket: "Service-ticket (URL)",
};

const CHANNEL_PLACEHOLDER: Record<Channel, string> = {
  phone: "+45 12 34 56 78",
  email: "service@leverandør.dk",
  service_ticket: "https://leverandør.dk/ticket/new",
};

function formatTarget(t: AdminEscalationTarget): string {
  return t.label ? `${t.label} — ${t.target}` : t.target;
}

export function MachineEscalationCard({
  accountId,
  accountLabel,
}: {
  accountId: string;
  // Display-friendly label for "this account is shared between machines".
  // Falls back to accountId if the caller hasn't resolved it.
  accountLabel?: string | null;
}) {
  const confirm = useConfirm();
  const [target, setTarget] = useState<AdminEscalationTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [channel, setChannel] = useState<Channel>("email");
  const [targetInput, setTargetInput] = useState("");
  const [labelInput, setLabelInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAdminEscalationTarget(accountId)
      .then((fetched) => {
        if (cancelled) return;
        setTarget(fetched);
        if (fetched) {
          setChannel(fetched.channel);
          setTargetInput(fetched.target);
          setLabelInput(fetched.label ?? "");
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Kunne ikke hente");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function startEdit() {
    setErr(null);
    if (!target) {
      setChannel("email");
      setTargetInput("");
      setLabelInput("");
    }
    setEditing(true);
  }

  function cancelEdit() {
    setErr(null);
    setEditing(false);
    if (target) {
      setChannel(target.channel);
      setTargetInput(target.target);
      setLabelInput(target.label ?? "");
    }
  }

  async function save() {
    const trimmed = targetInput.trim();
    if (!trimmed) {
      setErr("Target må ikke være tom");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const saved = await saveAdminEscalationTarget(accountId, {
        channel,
        target: trimmed,
        label: labelInput.trim() || null,
      });
      setTarget(saved);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fejl");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!target) return;
    const ok = await confirm({
      title: "Fjern service-target?",
      description:
        "Operatører kan ikke længere bruge 'Tilkald service'-knappen før der konfigureres en ny target. Tidligere escalations påvirkes ikke.",
      confirmLabel: "Fjern",
      danger: true,
    });
    if (!ok) return;
    setRemoving(true);
    setErr(null);
    try {
      await clearAdminEscalationTarget(accountId);
      setTarget(null);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Fejl");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-[var(--color-foreground)]" />
            <h2 className="text-[18px] font-semibold tracking-tight text-[var(--color-foreground)]">
              Service-eskalering
            </h2>
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
            Når operatøren trykker &laquo;Tilkald service&raquo; sendes en
            besked til denne kontakt med et midlertidigt link til samtalen.
            <span className="mt-1 block">
              Indstillingen deles på tværs af alle maskiner under{" "}
              <span className="font-medium text-[var(--color-foreground)]">
                {accountLabel ?? accountId}
              </span>
              .
            </span>
          </p>

          {loading ? (
            <div className="mt-4 flex items-center gap-2 text-[13px] text-[var(--color-muted-foreground)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Henter…
            </div>
          ) : editing ? (
            <EditForm
              channel={channel}
              setChannel={setChannel}
              targetInput={targetInput}
              setTargetInput={setTargetInput}
              labelInput={labelInput}
              setLabelInput={setLabelInput}
              saving={saving}
              onSave={save}
              onCancel={cancelEdit}
            />
          ) : target ? (
            <div className="mt-4 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Aktiv
                </span>
                <span className="text-[12px] text-[var(--color-muted-foreground)]">
                  {CHANNEL_LABEL[target.channel]}
                </span>
              </div>
              <p className="font-mono text-[14px] text-[var(--color-foreground)]">
                {formatTarget(target)}
              </p>
              {target.updatedBy && (
                <p className="text-[12px] text-[var(--color-muted-foreground)]">
                  Sidst opdateret af {target.updatedBy}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <span className="inline-flex rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted-foreground)]">
                Ikke konfigureret
              </span>
              <p className="mt-2 text-[13px] text-[var(--color-muted-foreground)]">
                Operatører ser knappen, men får en hint om at bede admin
                konfigurere kontakten først.
              </p>
            </div>
          )}

          {err && <p className="mt-2 text-[13px] text-red-600">{err}</p>}
        </div>

        {!editing && !loading && (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={startEdit}
              disabled={saving}
              className={cn(
                "inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-hairline)]",
                "bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-foreground)]",
                "transition-colors hover:bg-[var(--color-muted)] disabled:opacity-50",
              )}
            >
              <Pencil className="h-4 w-4" />
              {target ? "Redigér" : "Konfigurér"}
            </button>
            {target && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={removing}
                className={cn(
                  "inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-hairline)]",
                  "bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-red-700",
                  "transition-colors hover:bg-red-50 disabled:opacity-50",
                )}
              >
                {removing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Fjern
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function EditForm({
  channel,
  setChannel,
  targetInput,
  setTargetInput,
  labelInput,
  setLabelInput,
  saving,
  onSave,
  onCancel,
}: {
  channel: Channel;
  setChannel: (c: Channel) => void;
  targetInput: string;
  setTargetInput: (v: string) => void;
  labelInput: string;
  setLabelInput: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className="block text-[12px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
          Kanal
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            disabled={saving}
            className={cn(
              "mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--color-hairline)]",
              "bg-[var(--color-background)] px-3 text-[14px] font-normal normal-case",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          >
            <option value="phone">{CHANNEL_LABEL.phone}</option>
            <option value="email">{CHANNEL_LABEL.email}</option>
            <option value="service_ticket">{CHANNEL_LABEL.service_ticket}</option>
          </select>
        </label>
        <label className="block text-[12px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {channel === "phone"
            ? "Telefonnummer"
            : channel === "email"
              ? "E-mail-adresse"
              : "URL til ticket-system"}
          <input
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            placeholder={CHANNEL_PLACEHOLDER[channel]}
            disabled={saving}
            inputMode={
              channel === "phone"
                ? "tel"
                : channel === "email"
                  ? "email"
                  : "url"
            }
            className={cn(
              "mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--color-hairline)]",
              "bg-[var(--color-background)] px-3 text-[14px] font-mono",
              "placeholder:text-[var(--color-muted-foreground)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          />
        </label>
      </div>

      <label className="block text-[12px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
        Etiket (valgfrit — vises operatøren)
        <input
          value={labelInput}
          onChange={(e) => setLabelInput(e.target.value)}
          placeholder="F.eks. Felder service-hotline"
          disabled={saving}
          className={cn(
            "mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--color-hairline)]",
            "bg-[var(--color-background)] px-3 text-[14px] font-normal normal-case",
            "placeholder:text-[var(--color-muted-foreground)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          )}
        />
      </label>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={cn(
            "inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-hairline)]",
            "bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-muted-foreground)]",
            "transition-colors hover:text-[var(--color-foreground)] disabled:opacity-50",
          )}
        >
          <X className="h-4 w-4" />
          Annullér
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !targetInput.trim()}
          className={cn(
            "inline-flex items-center gap-2 rounded-[var(--radius)] border border-emerald-700",
            "bg-emerald-600 px-3 py-2 text-[13px] font-medium text-white",
            "transition-colors hover:bg-emerald-700 disabled:opacity-50",
          )}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : channel === "phone" ? (
            <Phone className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Gem
        </button>
      </div>
    </div>
  );
}
