"use client";

// "New account" wizard for super admins and partners. Creates the
// account (and its first admin user) in the Optipeople portal — the
// portal stays the source of truth — then walks through factory, a
// local Opti Assist machine, and an optional extra user.
//
// Steps 2–4 are individually skippable: the account exists in the
// portal after step 1, so anything skipped or failed can be finished in
// the portal itself.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Select } from "@/components/ui/select";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { useAuth } from "@/auth/AuthContext";
import { getAccounts, searchAccounts, type Account } from "@/auth/accountsApi";
import {
  createFactory,
  createPortalUser,
  getCountries,
  getRoles,
  getTimeZones,
  registerAccount,
  type PortalCountry,
  type PortalOption,
} from "@/auth/portalSetupApi";
import { createAdminMachine } from "@/admin/adminApi";

const TOTAL_STEPS = 4;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = 1 | 2 | 3 | 4 | "done";

export function NewAccountWizard({ onClose }: { onClose: () => void }) {
  const t = useTranslations("newAccountWizard");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const { reloadAccounts } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  // Set by step 1; every later step creates resources inside this account.
  const [accountId, setAccountId] = useState<string | null>(null);

  // Step 1 — account + first admin user (portal sends the invite mail).
  const [accountName, setAccountName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  // Step 2 — factory.
  const [factoryName, setFactoryName] = useState("");
  const [countries, setCountries] = useState<PortalCountry[] | null>(null);
  const [countriesError, setCountriesError] = useState<string | null>(null);
  const [countryId, setCountryId] = useState("");
  const [timeZones, setTimeZones] = useState<PortalOption[] | null>(null);
  const [timeZonesError, setTimeZonesError] = useState<string | null>(null);
  const [tzReload, setTzReload] = useState(0);
  const [timeZoneId, setTimeZoneId] = useState("");

  // Step 3 — local Opti Assist machine.
  const [machineName, setMachineName] = useState("");

  // Step 4 — optional extra user.
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [roles, setRoles] = useState<PortalOption[] | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [roleId, setRoleId] = useState("");

  const loadCountries = useCallback(() => {
    setCountriesError(null);
    getCountries()
      .then(setCountries)
      .catch((err: unknown) => {
        setCountriesError(
          err instanceof Error ? err.message : t("lookupFailed"),
        );
      });
  }, [t]);

  const loadRoles = useCallback(() => {
    setRolesError(null);
    getRoles()
      .then(setRoles)
      .catch((err: unknown) => {
        setRolesError(err instanceof Error ? err.message : t("lookupFailed"));
      });
  }, [t]);

  // Lazy lookups per step, loaded once. A failed lookup keeps the list
  // null (select disabled) and shows an inline error with retry. The
  // synchronous setState inside the loaders is their loading flag.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (step === 2 && countries === null && !countriesError) loadCountries();
    if (step === 4 && roles === null && !rolesError) loadRoles();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [step, countries, countriesError, roles, rolesError, loadCountries, loadRoles]);

  // Timezones depend on the chosen country. tzReload bumps re-run the
  // fetch after a failure.
  useEffect(() => {
    const country = countries?.find((c) => c.option.id === countryId);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!country) {
      setTimeZones(null);
      setTimeZoneId("");
      setTimeZonesError(null);
      return;
    }
    let cancelled = false;
    setTimeZones(null);
    setTimeZoneId("");
    setTimeZonesError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    getTimeZones(country)
      .then((rows) => {
        if (cancelled) return;
        setTimeZones(rows);
        if (rows.length === 1) setTimeZoneId(rows[0].id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTimeZonesError(
          err instanceof Error ? err.message : t("lookupFailed"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, countries, t, tzReload]);

  const finish = useCallback(async () => {
    // Surface the new account in the picker behind the wizard.
    await reloadAccounts().catch(() => undefined);
    setStep("done");
  }, [reloadAccounts]);

  // Closing on steps 2–4 silently abandons an account that already
  // exists in the portal — confirm first, and land on the done screen
  // (not plain dismissal) so re-running step 1 isn't the obvious next
  // move.
  const confirmingRef = useRef(false);
  const requestClose = useCallback(async () => {
    if (submitting || confirmingRef.current) return;
    if (step === 2 || step === 3 || step === 4) {
      confirmingRef.current = true;
      const ok = await confirm({
        title: t("closeConfirmTitle"),
        description: t("closeConfirmBody", { account: accountName.trim() }),
        confirmLabel: t("closeConfirmLabel"),
      });
      confirmingRef.current = false;
      if (!ok) return;
      await finish();
      return;
    }
    onClose();
  }, [step, submitting, confirm, t, accountName, finish, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // defaultPrevented: the confirm dialog handles its own Escape —
      // don't let that same keypress re-trigger the close flow.
      if (e.key === "Escape" && !e.defaultPrevented) void requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  async function run(action: () => Promise<void>) {
    setSubmitting(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const submitAccount = () =>
    run(async () => {
      const name = accountName.trim();
      let id = await registerAccount({
        accountName: name,
        adminName: adminName.trim(),
        email: adminEmail.trim(),
      });
      if (!id) {
        // The portal response didn't carry the new id — recover it by
        // name from the account lists. A partner's Account/GetAll can
        // omit an account they just registered, so also try the paged
        // search the portal backoffice itself lists accounts with.
        const byName = (rows: Account[]) =>
          rows.find(
            (a) => a.name.trim().toLowerCase() === name.toLowerCase(),
          )?.id ?? null;
        const all = await getAccounts().catch(() => []);
        id = byName(all);
        if (!id) {
          id = byName(await searchAccounts(name).catch(() => []));
        }
      }
      if (!id) {
        // Account exists in the portal but we can't address it, so the
        // remaining steps can't run. Not retryable — creating again
        // would duplicate the account. Land on the done screen (with
        // the picker refreshed) and explain.
        await finish();
        setError(t("accountCreatedButUnresolved"));
        return;
      }
      setAccountId(id);
      setStep(2);
    });

  const submitFactory = () =>
    run(async () => {
      const country = countries?.find((c) => c.option.id === countryId);
      const timeZone = timeZones?.find((tz) => tz.id === timeZoneId);
      if (!accountId || !country || !timeZone) return;
      await createFactory({
        accountId,
        name: factoryName.trim(),
        country: country.option,
        timeZone,
      });
      setStep(3);
    });

  const submitMachine = () =>
    run(async () => {
      if (!accountId) return;
      await createAdminMachine({
        accountId,
        displayName: machineName.trim(),
      });
      setStep(4);
    });

  const submitUser = () =>
    run(async () => {
      if (!accountId) return;
      await createPortalUser({
        accountId,
        name: userName.trim(),
        email: userEmail.trim(),
        roleId,
      });
      await finish();
    });

  const skipTo = (next: Step) => {
    setError(null);
    if (next === "done") void finish();
    else setStep(next);
  };

  const stepNumber = step === "done" ? TOTAL_STEPS : step;
  const adminEmailValid = EMAIL_RE.test(adminEmail.trim());
  const userEmailValid = EMAIL_RE.test(userEmail.trim());
  const canSubmitAccount =
    accountName.trim().length > 0 &&
    adminName.trim().length > 0 &&
    adminEmailValid;
  const canSubmitFactory =
    factoryName.trim().length > 0 && countryId.length > 0 && timeZoneId.length > 0;
  const canSubmitMachine = machineName.trim().length > 0;
  const canSubmitUser =
    userName.trim().length > 0 && userEmailValid && roleId.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogAria")}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-3 sm:px-4 sm:py-8"
    >
      <div
        ref={panelRef}
        className="my-auto flex w-full max-w-lg flex-col gap-4 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 shadow-xl sm:gap-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[18px]">
              {step === "done" ? t("doneHeading") : t(`step${step}Heading`)}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">
              {step === "done"
                ? t("doneDescription", { account: accountName.trim() })
                : t(`step${step}Description`)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requestClose()}
            disabled={submitting}
            aria-label={t("closeAria")}
            className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step !== "done" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-[var(--color-muted-foreground)]">
              {t("stepLabel", { step: stepNumber, total: TOTAL_STEPS })}
            </span>
            <ProgressBar value={(stepNumber / TOTAL_STEPS) * 100} />
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <TextField
              label={t("accountNameLabel")}
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              disabled={submitting}
            />
            <TextField
              label={t("adminNameLabel")}
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              disabled={submitting}
            />
            <TextField
              label={t("adminEmailLabel")}
              type="email"
              validation={
                adminEmail.trim().length > 0 && !adminEmailValid
                  ? "error"
                  : "none"
              }
              helpText={
                adminEmail.trim().length > 0 && !adminEmailValid
                  ? t("emailInvalid")
                  : t("adminEmailHelp")
              }
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              disabled={submitting}
            />
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <TextField
              label={t("factoryNameLabel")}
              value={factoryName}
              onChange={(e) => setFactoryName(e.target.value)}
              disabled={submitting}
            />
            <Select
              label={t("countryLabel")}
              placeholder={
                countries === null && !countriesError
                  ? t("loadingLookup")
                  : undefined
              }
              value={countryId}
              onValueChange={setCountryId}
              disabled={submitting || countries === null}
              items={(countries ?? []).map((c) => ({
                value: c.option.id,
                label: c.option.name,
              }))}
            />
            {countriesError && (
              <LookupError
                message={countriesError}
                onRetry={loadCountries}
                retryLabel={tc("retry")}
              />
            )}
            <Select
              label={t("timeZoneLabel")}
              placeholder={
                countryId && timeZones === null && !timeZonesError
                  ? t("loadingLookup")
                  : timeZones?.length === 0
                    ? t("timeZoneEmpty")
                    : undefined
              }
              value={timeZoneId}
              onValueChange={setTimeZoneId}
              disabled={
                submitting ||
                !countryId ||
                timeZones === null ||
                timeZones.length === 0
              }
              items={(timeZones ?? []).map((tz) => ({
                value: tz.id,
                label: tz.name,
              }))}
            />
            {timeZonesError && (
              <LookupError
                message={timeZonesError}
                onRetry={() => setTzReload((n) => n + 1)}
                retryLabel={tc("retry")}
              />
            )}
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-3">
            <TextField
              label={t("machineNameLabel")}
              helpText={t("machineNameHelp")}
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
              disabled={submitting}
            />
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-3">
            <TextField
              label={t("userNameLabel")}
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              disabled={submitting}
            />
            <TextField
              label={t("userEmailLabel")}
              type="email"
              validation={
                userEmail.trim().length > 0 && !userEmailValid
                  ? "error"
                  : "none"
              }
              helpText={
                userEmail.trim().length > 0 && !userEmailValid
                  ? t("emailInvalid")
                  : t("userEmailHelp")
              }
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              disabled={submitting}
            />
            <Select
              label={t("roleLabel")}
              placeholder={
                roles === null && !rolesError ? t("loadingLookup") : undefined
              }
              value={roleId}
              onValueChange={setRoleId}
              disabled={submitting || roles === null}
              items={(roles ?? []).map((r) => ({ value: r.id, label: r.name }))}
            />
            {rolesError && (
              <LookupError
                message={rolesError}
                onRetry={loadRoles}
                retryLabel={tc("retry")}
              />
            )}
          </div>
        )}

        {error && <p className="text-[13px] text-[var(--ds-red)]">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          {step === 1 && (
            <>
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
                onClick={() => void submitAccount()}
                disabled={!canSubmitAccount || submitting}
              >
                {submitting ? (
                  <Spinner className="mr-1.5 h-4 w-4" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                {t("createAccount")}
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => !submitting && skipTo(3)}
                disabled={submitting}
              >
                {t("skip")}
              </Button>
              <Button
                size="compact"
                onClick={() => void submitFactory()}
                disabled={!canSubmitFactory || submitting}
              >
                {submitting ? (
                  <Spinner className="mr-1.5 h-4 w-4" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                {t("createFactory")}
              </Button>
            </>
          )}

          {step === 3 && (
            <>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  if (submitting) return;
                  setError(null);
                  setStep(2);
                }}
                disabled={submitting}
              >
                {tc("back")}
              </Button>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => !submitting && skipTo(4)}
                disabled={submitting}
              >
                {t("skip")}
              </Button>
              <Button
                size="compact"
                onClick={() => void submitMachine()}
                disabled={!canSubmitMachine || submitting}
              >
                {submitting ? (
                  <Spinner className="mr-1.5 h-4 w-4" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                {t("createMachine")}
              </Button>
            </>
          )}

          {step === 4 && (
            <>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  if (submitting) return;
                  setError(null);
                  setStep(3);
                }}
                disabled={submitting}
              >
                {tc("back")}
              </Button>
              <Button
                variant="secondary"
                size="compact"
                onClick={() => !submitting && skipTo("done")}
                disabled={submitting}
              >
                {t("skip")}
              </Button>
              <Button
                size="compact"
                onClick={() => void submitUser()}
                disabled={!canSubmitUser || submitting}
              >
                {submitting ? (
                  <Spinner className="mr-1.5 h-4 w-4" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                {t("createUser")}
              </Button>
            </>
          )}

          {step === "done" && (
            <Button size="compact" onClick={onClose}>
              {t("done")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LookupError({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry: () => void;
  retryLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--ds-red)]">
      <span className="min-w-0 break-words">{message}</span>
      <Button variant="ghost" size="pill" onClick={onRetry} className="shrink-0">
        <RefreshCw className="h-3 w-3" />
        {retryLabel}
      </Button>
    </div>
  );
}
