"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Lock, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ToggleButton } from "@/components/ui/toggle-button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  createAiRule,
  deleteAiRule,
  listAiRules,
  updateAiRule,
  type AccountAiRule,
} from "@/admin/aiRulesAdminApi";
import { getAccounts } from "@/auth/accountsApi";
import { cn } from "@/lib/utils";

const MAX_RULE_BODY_LENGTH = 2000;

// Per-account rules editor. The locked baseline rule is rendered from
// `systemRule` (returned by the API and ultimately sourced from
// src/lib/aiRules.ts) at the top of the list. Below it: editable rules,
// one card each, with body / enabled / position controls.
//
// `embedded` skips the page-level H1 + description for use inside a
// section panel (the section header provides the title).
export function AiRulesEditor({
  accountId,
  embedded = false,
}: {
  accountId: string;
  embedded?: boolean;
}) {
  const t = useTranslations("admin.aiRules");
  const confirm = useConfirm();
  const [systemRule, setSystemRule] = useState<string>("");
  const [rules, setRules] = useState<AccountAiRule[] | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    const data = await listAiRules(accountId);
    setSystemRule(data.systemRule);
    setRules(data.rules);
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listAiRules(accountId), getAccounts().catch(() => [])])
      .then(([data, accounts]) => {
        if (cancelled) return;
        setSystemRule(data.systemRule);
        setRules(data.rules);
        const match = accounts.find((a) => a.id === accountId);
        setAccountName(match?.name ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  async function handleAdd() {
    const body = draft.trim();
    if (body.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      const rule = await createAiRule(accountId, body);
      setRules((cur) => [...(cur ?? []), rule]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addFailed"));
    } finally {
      setAdding(false);
    }
  }

  async function handleSave(ruleId: string, body: string) {
    setError(null);
    try {
      const updated = await updateAiRule(accountId, ruleId, { body });
      setRules((cur) =>
        (cur ?? []).map((r) => (r.id === ruleId ? updated : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    }
  }

  async function handleToggle(rule: AccountAiRule) {
    setError(null);
    try {
      const updated = await updateAiRule(accountId, rule.id, {
        enabled: !rule.enabled,
      });
      setRules((cur) =>
        (cur ?? []).map((r) => (r.id === rule.id ? updated : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("toggleFailed"));
    }
  }

  async function handleDelete(rule: AccountAiRule) {
    const ok = await confirm({
      title: t("deleteConfirmTitle"),
      description: t("deleteConfirmBody"),
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteAiRule(accountId, rule.id);
      setRules((cur) => (cur ?? []).filter((r) => r.id !== rule.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
    }
  }

  // Swap two rules' positions. We commit both writes serially so the
  // DB state matches what the UI shows even if one fails midway.
  async function handleMove(index: number, direction: -1 | 1) {
    if (!rules) return;
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const a = rules[index];
    const b = rules[target];
    setError(null);
    // Optimistic swap so the UI doesn't jitter while the requests fly.
    const swapped = [...rules];
    swapped[index] = { ...b, position: a.position };
    swapped[target] = { ...a, position: b.position };
    setRules(swapped);
    try {
      await updateAiRule(accountId, a.id, { position: b.position });
      await updateAiRule(accountId, b.id, { position: a.position });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reorderFailed"));
      // Best effort: reload to recover canonical order.
      await reload().catch(() => {});
    }
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      {embedded ? (
        <p className="text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
          {t("description")}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[24px]">
            {t("heading", { name: accountName ?? accountId })}
          </h1>
          <p className="text-[13px] text-[var(--color-muted-foreground)] sm:text-[14px]">
            {t("description")}
          </p>
        </div>
      )}

      {error ? (
        <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-4 text-[13px] text-[var(--ds-red-dark)]">
          {error}
        </div>
      ) : null}

      {/* Locked rule */}
      <LockedRuleCard body={systemRule} loading={rules === null} />

      {/* Editable rules */}
      {rules === null ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <EditableRuleCard
              key={r.id}
              rule={r}
              index={i}
              total={rules.length}
              onSave={(body) => handleSave(r.id, body)}
              onToggle={() => handleToggle(r)}
              onDelete={() => handleDelete(r)}
              onMoveUp={() => handleMove(i, -1)}
              onMoveDown={() => handleMove(i, 1)}
            />
          ))}
        </div>
      )}

      {/* Add new */}
      <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:p-5">
        <h2 className="text-[15px] font-medium text-[var(--color-foreground)]">
          {t("addHeading")}
        </h2>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">
          {t("addDescription")}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_RULE_BODY_LENGTH))}
          placeholder={t("addPlaceholder")}
          rows={3}
          disabled={adding}
          className={cn(
            "mt-3 w-full resize-y rounded-[4px] border border-[var(--color-hairline)] bg-white px-3 py-2",
            "text-[14px] leading-[21px] text-[var(--ds-grey-dark-09)] shadow-[var(--ds-shadow-input)]",
            "focus:outline-none focus:ring-2 focus:ring-[var(--ds-green-80)]",
          )}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--color-muted-foreground)]">
            {draft.length} / {MAX_RULE_BODY_LENGTH}
          </span>
          <Button
            variant="secondary"
            size="compact"
            onClick={handleAdd}
            disabled={adding || draft.trim().length === 0}
          >
            {adding ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              t("addButton")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LockedRuleCard({
  body,
  loading,
}: {
  body: string;
  loading: boolean;
}) {
  const t = useTranslations("admin.aiRules");
  const tc = useTranslations("common");
  return (
    <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-muted)]/40 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 text-[var(--color-muted-foreground)]" />
        <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {t("lockedHeading")}
        </span>
      </div>
      <p className="mt-2 text-[14px] leading-[21px] text-[var(--color-foreground)]">
        {loading ? (
          <span className="text-[var(--color-muted-foreground)]">
            {tc("loading")}
          </span>
        ) : (
          body
        )}
      </p>
      <p className="mt-2 text-[11px] text-[var(--color-muted-foreground)]">
        {t("lockedFootnote")}
      </p>
    </div>
  );
}

function EditableRuleCard({
  rule,
  index,
  total,
  onSave,
  onToggle,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  rule: AccountAiRule;
  index: number;
  total: number;
  onSave: (body: string) => Promise<void>;
  onToggle: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMoveUp: () => Promise<void>;
  onMoveDown: () => Promise<void>;
}) {
  const t = useTranslations("admin.aiRules");
  const tc = useTranslations("common");
  const [body, setBody] = useState(rule.body);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastSyncedBody = useRef(rule.body);

  // Pull in upstream changes (reorder, toggle, etc. all return the
  // refreshed row) when nothing's been typed yet.
  useEffect(() => {
    if (body === lastSyncedBody.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBody(rule.body);
      lastSyncedBody.current = rule.body;
    }
  }, [rule.body, body]);

  const dirty = body.trim() !== rule.body.trim();
  const canSave = dirty && body.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(body.trim());
      lastSyncedBody.current = body.trim();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    setBusy(true);
    try {
      await onToggle();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteClick() {
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-[4px] border bg-[var(--color-surface)] p-3 sm:p-4",
        rule.enabled
          ? "border-[var(--color-hairline)]"
          : "border-dashed border-[var(--color-hairline)] opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex flex-col gap-1">
          <Tooltip
            content={t("moveUp")}
            side="right"
            disabled={index === 0 || busy}
          >
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0 || busy}
              aria-label={t("moveUp")}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted-foreground)]",
                "hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
              )}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip
            content={t("moveDown")}
            side="right"
            disabled={index === total - 1 || busy}
          >
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === total - 1 || busy}
              aria-label={t("moveDown")}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted-foreground)]",
                "hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
              )}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>

        <div className="min-w-0 flex-1">
          <textarea
            value={body}
            onChange={(e) =>
              setBody(e.target.value.slice(0, MAX_RULE_BODY_LENGTH))
            }
            rows={3}
            disabled={saving || busy}
            className={cn(
              "w-full resize-y rounded-[4px] border border-[var(--color-hairline)] bg-white px-3 py-2",
              "text-[14px] leading-[21px] text-[var(--ds-grey-dark-09)] shadow-[var(--ds-shadow-input)]",
              "focus:outline-none focus:ring-2 focus:ring-[var(--ds-green-80)]",
            )}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <ToggleButton
              checked={rule.enabled}
              onCheckedChange={handleToggle}
              disabled={busy}
              aria-label={rule.enabled ? t("disableRule") : t("enableRule")}
            />

            <div className="flex items-center gap-2">
              {dirty ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setBody(rule.body)}
                  disabled={saving}
                >
                  {t("reset")}
                </Button>
              ) : null}
              <Button size="sm" onClick={handleSave} disabled={!canSave}>
                {saving ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  tc("save")
                )}
              </Button>
              <Tooltip content={t("deleteRule")} side="top" disabled={busy}>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeleteClick}
                  disabled={busy}
                  aria-label={t("deleteRule")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

