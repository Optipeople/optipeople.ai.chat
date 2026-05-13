"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { getAccounts, type Account } from "@/auth/accountsApi";
import {
  getMachinesForAccount,
  type Machine,
} from "@/auth/machinesApi";
import { createAdminMachine } from "@/admin/adminApi";

export function AddMachineDialog({
  existingMachineIds,
  onClose,
  onCreated,
}: {
  existingMachineIds: Set<string>;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const t = useTranslations("admin.addMachine");
  // Step 1: accounts loaded once on mount.
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsErr, setAccountsErr] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  // Step 2: machines loaded lazily when an account is picked.
  const [machines, setMachines] = useState<Machine[] | null>(null);
  const [machinesErr, setMachinesErr] = useState<string | null>(null);
  const [machine, setMachine] = useState<Machine | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // Load accounts once.
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
  }, []);

  // Re-fetch machines whenever the chosen account changes.
  useEffect(() => {
    if (!account) {
      // Clear cached list when the account selection is cleared.
      /* eslint-disable react-hooks/set-state-in-effect */
      setMachines(null);
      setMachinesErr(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    let cancelled = false;
    setMachines(null);
    setMachinesErr(null);
    getMachinesForAccount(account.id)
      .then((rows) => {
        if (!cancelled) {
          setMachines(rows.sort((a, b) => a.name.localeCompare(b.name)));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMachinesErr(
            err instanceof Error ? err.message : t("machinesFetchFailed"),
          );
          setMachines([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  function pickAccount(a: Account) {
    if (account?.id === a.id) return;
    setAccount(a);
    setMachine(null);
    setDisplayName("");
    setSubmitErr(null);
  }

  function pickMachine(m: Machine) {
    if (existingMachineIds.has(m.id)) return;
    setMachine(m);
    setDisplayName(m.name);
    setSubmitErr(null);
  }

  async function submit() {
    if (!account || !machine || submitting) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      await createAdminMachine({
        machineId: machine.id,
        accountId: account.id,
        displayName: displayName.trim() || machine.name,
      });
      await onCreated();
      onClose();
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : t("submitFailed"));
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
      <div className="my-auto flex w-full max-w-lg flex-col gap-4 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 shadow-xl sm:gap-5 sm:p-6">
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

        <Combobox
          label={t("accountLabel")}
          placeholder={
            accounts === null ? t("accountsLoading") : t("accountsPlaceholder")
          }
          noMatchLabel={t("noMatch")}
          clearAriaLabel={t("clearAria")}
          loading={accounts === null}
          loadErr={accountsErr}
          options={accounts ?? []}
          getKey={(a) => a.id}
          getLabel={(a) => a.name}
          getSubLabel={() => null}
          isDisabledOption={() => false}
          selected={account}
          onSelect={pickAccount}
          disabled={submitting}
        />

        <Combobox
          label={t("machineLabel")}
          placeholder={
            !account
              ? t("machinePickAccountFirst")
              : machines === null
                ? t("machinesLoading")
                : t("machinesPlaceholder")
          }
          noMatchLabel={t("noMatch")}
          clearAriaLabel={t("clearAria")}
          loading={!!account && machines === null}
          loadErr={machinesErr}
          options={machines ?? []}
          getKey={(m) => m.id}
          getLabel={(m) => m.name}
          getSubLabel={(m) =>
            existingMachineIds.has(m.id) ? t("alreadyCreated") : null
          }
          isDisabledOption={(m) => existingMachineIds.has(m.id)}
          selected={machine}
          onSelect={pickMachine}
          disabled={!account || submitting}
        />

        <TextField
          label={t("displayNameLabel")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t("displayNamePlaceholder")}
          disabled={!machine || submitting}
        />

        {submitErr && (
          <p className="text-[13px] text-[var(--ds-red)]">{submitErr}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => !submitting && onClose()}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => void submit()}
            disabled={!machine || submitting}
          >
            {submitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
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

// Generic searchable single-select. Self-contained — handles its own query
// state, open/close, and outside-click. We use it twice in this dialog so
// it earns the abstraction; not a general-purpose component.
function Combobox<T>({
  label,
  placeholder,
  loading,
  loadErr,
  options,
  getKey,
  getLabel,
  getSubLabel,
  isDisabledOption,
  selected,
  onSelect,
  disabled,
  noMatchLabel,
  clearAriaLabel,
}: {
  label: string;
  placeholder: string;
  loading: boolean;
  loadErr: string | null;
  options: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSubLabel: (item: T) => string | null;
  isDisabledOption: (item: T) => boolean;
  selected: T | null;
  onSelect: (item: T) => void;
  disabled: boolean;
  noMatchLabel: string;
  clearAriaLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep input in sync with selection from outside (e.g. parent clearing).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selected) setQuery(getLabel(selected));
    else setQuery("");
  }, [selected, getLabel]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // If the input still equals the selected label exactly, treat it as
    // "no filter" so the user sees the full list when they reopen.
    const effectiveQuery =
      selected && query === getLabel(selected) ? "" : q;
    const base = effectiveQuery
      ? options.filter((o) =>
          getLabel(o).toLowerCase().includes(effectiveQuery),
        )
      : options;
    return base.slice(0, 200);
  }, [options, query, selected, getLabel]);

  function clear() {
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-[13px] font-medium text-[var(--color-foreground)]">
        {label}
      </label>
      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled || loading}
          className={cn(
            "h-10 w-full rounded-[4px] border border-[var(--color-hairline)]",
            "bg-[var(--color-background)] pl-9 pr-9 text-[14px]",
            "placeholder:text-[var(--color-muted-foreground)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            "disabled:opacity-60",
          )}
        />
        {selected && !disabled ? (
          <button
            type="button"
            onClick={clear}
            aria-label={clearAriaLabel}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
        )}
      </div>

      {open && !disabled && !loading && (
        <div className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-[var(--color-muted-foreground)]">
              {loadErr ?? noMatchLabel}
            </div>
          ) : (
            filtered.map((o) => {
              const key = getKey(o);
              const optDisabled = isDisabledOption(o);
              const isSelected = selected ? getKey(selected) === key : false;
              const sub = getSubLabel(o);
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => {
                    if (optDisabled) return;
                    onSelect(o);
                    setOpen(false);
                  }}
                  disabled={optDisabled}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-[var(--color-hairline)]/60 px-3 py-2 text-left text-[13px] last:border-b-0",
                    optDisabled
                      ? "cursor-not-allowed opacity-50"
                      : "hover:bg-[var(--color-muted)]/60",
                    isSelected && "bg-[var(--color-muted)]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--color-foreground)]">
                      {getLabel(o)}
                    </div>
                    {sub && (
                      <div className="truncate text-[12px] text-[var(--color-muted-foreground)]">
                        {sub}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-[var(--ds-green)]" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
