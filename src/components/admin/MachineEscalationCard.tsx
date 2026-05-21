"use client";

import { useEffect, useState } from "react";
import {
  Check,
  MessageSquare,
  Pencil,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tag } from "@/components/ui/tag";
import { TextField } from "@/components/ui/text-field";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  clearAdminEscalationTarget,
  getAdminEscalationTarget,
  saveAdminEscalationTarget,
  type AdminEscalationTarget,
} from "@/admin/adminApi";
import { getAccounts } from "@/auth/accountsApi";

type Channel = AdminEscalationTarget["channel"];

const CHANNEL_PLACEHOLDER: Record<Channel, string> = {
  sms: "+4512345678",
  email: "service@leverandør.dk",
  service_ticket: "https://leverandør.dk/ticket/new",
  webhook: "https://api.helpdesk.dk/optipeople/escalate",
};

function formatTarget(t: AdminEscalationTarget): string {
  return t.label ? `${t.label} — ${t.target}` : t.target;
}

export function MachineEscalationCard({
  accountId,
}: {
  accountId: string;
}) {
  const t = useTranslations("admin.machineEscalation");
  const CHANNEL_LABEL: Record<Channel, string> = {
    sms: t("channels.sms"),
    email: t("channels.email"),
    service_ticket: t("channels.service_ticket"),
    webhook: t("channels.webhook"),
  };
  const confirm = useConfirm();
  const [target, setTarget] = useState<AdminEscalationTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Optipeople-registered account name. Best-effort; falls back to the
  // account id in the few UI strings that need a display label. Operator-
  // role admins can hit getAccounts but the network may also fail, in
  // which case we silently degrade.
  const [accountName, setAccountName] = useState<string | null>(null);

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
        setErr(e instanceof Error ? e.message : t("fetchFailed"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    getAccounts()
      .then((accounts) => {
        if (cancelled) return;
        setAccountName(accounts.find((a) => a.id === accountId)?.name ?? null);
      })
      .catch(() => {
        // Silent — UI degrades to the account id where a name is needed.
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
      setErr(t("targetRequired"));
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
      setErr(e instanceof Error ? e.message : t("genericError"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!target) return;
    const ok = await confirm({
      title: t("removeConfirmTitle"),
      description: t("removeConfirmBody"),
      confirmLabel: t("removeConfirmLabel"),
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
      setErr(e instanceof Error ? e.message : t("genericError"));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 shrink-0 text-[var(--color-foreground)]" />
            <h2 className="text-[17px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[18px]">
              {t("heading")}
            </h2>
          </div>
          <p className="mt-1 break-words text-[13px] text-[var(--color-muted-foreground)]">
            {t("description")}
            <span className="mt-1 block">
              {t("sharedAcrossPrefix")}{" "}
              <span className="font-medium text-[var(--color-foreground)]">
                {accountName ?? accountId}
              </span>
              .
            </span>
          </p>
        </div>

        {!editing && !loading && (
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:flex-nowrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={startEdit}
              disabled={saving}
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              {target ? t("edit") : t("configure")}
            </Button>
            {target && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void remove()}
                disabled={removing}
              >
                {removing ? (
                  <Spinner className="mr-1.5 h-4 w-4" />
                ) : (
                  <Trash2 className="mr-1.5 h-4 w-4" />
                )}
                {t("remove")}
              </Button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-[var(--color-muted-foreground)]">
          <Spinner className="h-3.5 w-3.5" />
          {t("loading")}
        </div>
      ) : editing ? (
        <EditForm
          channel={channel}
          setChannel={setChannel}
          targetInput={targetInput}
          setTargetInput={setTargetInput}
          labelInput={labelInput}
          setLabelInput={setLabelInput}
          accountName={accountName}
          saving={saving}
          onSave={save}
          onCancel={cancelEdit}
        />
      ) : target ? (
        <div className="mt-4 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Tag variant="positive" size="small">
              {t("active")}
            </Tag>
            <span className="text-[12px] text-[var(--color-muted-foreground)]">
              {CHANNEL_LABEL[target.channel]}
            </span>
          </div>
          <p className="break-all font-mono text-[14px] text-[var(--color-foreground)]">
            {formatTarget(target)}
          </p>
          {target.updatedBy && (
            <p className="text-[12px] text-[var(--color-muted-foreground)]">
              {t("lastUpdatedBy", { by: target.updatedBy })}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <Tag variant="default" size="small">
            {t("notConfigured")}
          </Tag>
          <p className="mt-2 text-[13px] text-[var(--color-muted-foreground)]">
            {t("notConfiguredHint")}
          </p>
        </div>
      )}

      {err && (
        <p className="mt-2 text-[13px] text-[var(--ds-red)]">{err}</p>
      )}
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
  accountName,
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
  accountName: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("admin.machineEscalation");
  const CHANNEL_LABEL: Record<Channel, string> = {
    sms: t("channels.sms"),
    email: t("channels.email"),
    service_ticket: t("channels.service_ticket"),
    webhook: t("channels.webhook"),
  };
  const targetLabel =
    channel === "sms"
      ? t("targetSms")
      : channel === "email"
        ? t("targetEmail")
        : channel === "webhook"
          ? t("targetWebhook")
          : t("targetServiceTicket");

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Select
        label={t("channelLabel")}
        value={channel}
        onValueChange={(v) => setChannel(v as Channel)}
        disabled={saving}
      >
        <option value="sms">{CHANNEL_LABEL.sms}</option>
        <option value="email">{CHANNEL_LABEL.email}</option>
        <option value="service_ticket">{CHANNEL_LABEL.service_ticket}</option>
        <option value="webhook">{CHANNEL_LABEL.webhook}</option>
      </Select>
      <TextField
        label={targetLabel}
        value={targetInput}
        onChange={(e) => setTargetInput(e.target.value)}
        placeholder={CHANNEL_PLACEHOLDER[channel]}
        disabled={saving}
        inputMode={
          channel === "sms"
            ? "tel"
            : channel === "email"
              ? "email"
              : "url"
        }
        className="font-mono"
      />

      <TextField
        label={t("labelLabel")}
        value={labelInput}
        onChange={(e) => setLabelInput(e.target.value)}
        placeholder={
          accountName
            ? t("labelPlaceholderForAccount", { account: accountName })
            : t("labelPlaceholderDefault")
        }
        disabled={saving}
      />

      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          disabled={saving}
        >
          <X className="mr-1.5 h-4 w-4" />
          {t("cancel")}
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={saving || !targetInput.trim()}
        >
          {saving ? (
            <Spinner className="mr-1.5 h-4 w-4" />
          ) : channel === "sms" ? (
            <MessageSquare className="mr-1.5 h-4 w-4" />
          ) : (
            <Check className="mr-1.5 h-4 w-4" />
          )}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
