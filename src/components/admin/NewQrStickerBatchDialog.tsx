"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Spinner, Button, TextField } from "@optipeople/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { getAccounts, type Account } from "@/auth/accountsApi";
import { adminErrorMessage, createQrStickerBatch } from "@/admin/adminApi";
import { Combobox } from "@/components/admin/AddMachineDialog";
import type { QrStickerBatch } from "@/lib/qrStickerTypes";

const MAX_COUNT = 1000;

// Option meaning "no account": the batch stays in the global pool and the
// first claim binds each sticker to an account.
const NO_ACCOUNT_ID = "";

// Stable callbacks for Combobox: it re-syncs its input whenever getLabel
// changes identity, so inline arrows would reset the query on every
// parent render.
const accountKey = (a: Account) => a.id;
const accountLabel = (a: Account) => a.name;
const noSubLabel = () => null;
const neverDisabled = () => false;

// Modal form for a new sticker batch. Same shell as AddMachineDialog.
export function NewQrStickerBatchDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (batch: QrStickerBatch) => void;
}) {
  const t = useTranslations("admin.qrStickers.batchDialog");
  const tErr = useTranslations("admin.apiErrors");
  const tc = useTranslations("common");
  const noAccount = useMemo<Account>(
    () => ({ id: NO_ACCOUNT_ID, name: t("accountNone") }),
    [t],
  );

  const [label, setLabel] = useState("");
  const [countText, setCountText] = useState("100");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsErr, setAccountsErr] = useState<string | null>(null);
  const [account, setAccount] = useState<Account>(noAccount);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    let cancelled = false;
    getAccounts()
      .then((rows) => {
        if (!cancelled) {
          setAccounts(rows.sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAccountsErr(
            err instanceof Error ? err.message : t("accountsFetchFailed"),
          );
          setAccounts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const options = useMemo(
    () => [noAccount, ...(accounts ?? [])],
    [noAccount, accounts],
  );

  const count = Number(countText);
  const countValid =
    Number.isInteger(count) && count >= 1 && count <= MAX_COUNT;
  const labelValid = label.trim().length > 0;
  const canSubmit = labelValid && countValid && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const res = await createQrStickerBatch({
        label: label.trim(),
        count,
        accountId: account.id === NO_ACCOUNT_ID ? null : account.id,
      });
      onCreated(res.batch);
    } catch (err) {
      setSubmitErr(adminErrorMessage(err, tErr) ?? tc("unknownError"));
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogAria")}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-3 sm:px-4 sm:py-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="my-auto flex w-full max-w-lg flex-col gap-4 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 shadow-xl sm:gap-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[18px]">
              {t("heading")}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
              {t("description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            aria-label={t("closeAria")}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <TextField
          label={t("labelLabel")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("labelPlaceholder")}
          disabled={submitting}
          autoFocus
        />

        <TextField
          label={t("countLabel")}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_COUNT}
          step={1}
          value={countText}
          onChange={(e) => setCountText(e.target.value)}
          helpText={countValid ? t("countHelp") : t("countInvalid")}
          validation={countValid ? "none" : "error"}
          disabled={submitting}
        />

        <div>
          <Combobox
            label={t("accountLabel")}
            placeholder={
              accounts === null
                ? t("accountsLoading")
                : t("accountsPlaceholder")
            }
            noMatchLabel={t("noMatch")}
            clearAriaLabel={t("clearAria")}
            loading={accounts === null}
            loadErr={accountsErr}
            options={options}
            getKey={accountKey}
            getLabel={accountLabel}
            getSubLabel={noSubLabel}
            isDisabledOption={neverDisabled}
            selected={account}
            onSelect={setAccount}
            disabled={submitting}
          />
          <p className="mt-1 text-[12px] text-[var(--color-muted-foreground)]">
            {t("accountHelp")}
          </p>
        </div>

        {submitErr && (
          <p className="text-[13px] text-[var(--ds-red)]">{submitErr}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="compact"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            size="compact"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {submitting ? (
              <Spinner className="mr-1.5 h-4 w-4" />
            ) : (
              <Check className="mr-1.5 h-4 w-4" />
            )}
            {t("submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
