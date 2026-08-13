"use client";

// "New account" wizard for super admins and partners. Creates the
// account (and its first admin user) in the Optipeople portal — the
// portal stays the source of truth — then walks through factory, a
// local Opti Assist machine, and an optional extra user.
//
// Steps 2–4 are individually skippable: the account exists in the
// portal after step 1, so anything skipped or failed can be finished in
// the portal itself.

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Select } from "@/components/ui/select";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/auth/AuthContext";
import { getAccounts } from "@/auth/accountsApi";
import {
  createFactory,
  createPortalUser,
  getCountries,
  getRoles,
  getSubscriptionTypes,
  getTimeZones,
  registerNewAccount,
  type PortalCountry,
  type PortalOption,
  type PortalTimeZone,
} from "@/auth/portalSetupApi";
import { createAdminMachine } from "@/admin/adminApi";

const TOTAL_STEPS = 4;

type Step = 1 | 2 | 3 | 4 | "done";

export function NewAccountWizard({ onClose }: { onClose: () => void }) {
  const t = useTranslations("newAccountWizard");
  const { reloadAccounts } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set by step 1; every later step creates resources inside this account.
  const [accountId, setAccountId] = useState<string | null>(null);

  // Step 1 — account + first admin user (portal sends the invite mail).
  const [accountName, setAccountName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [subscriptionTypes, setSubscriptionTypes] = useState<
    PortalOption[] | null
  >(null);
  const [subscriptionTypeId, setSubscriptionTypeId] = useState("");

  // Step 2 — factory.
  const [factoryName, setFactoryName] = useState("");
  const [countries, setCountries] = useState<PortalCountry[] | null>(null);
  const [countryId, setCountryId] = useState("");
  const [timeZones, setTimeZones] = useState<PortalTimeZone[] | null>(null);
  const [timeZoneId, setTimeZoneId] = useState("");

  // Step 3 — local Opti Assist machine.
  const [machineName, setMachineName] = useState("");

  // Step 4 — optional extra user.
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [roles, setRoles] = useState<PortalOption[] | null>(null);
  const [roleId, setRoleId] = useState("");

  // Lazy lookups per step, loaded once.
  useEffect(() => {
    if (step === 1 && subscriptionTypes === null) {
      getSubscriptionTypes()
        .then(setSubscriptionTypes)
        .catch((err: unknown) => {
          setSubscriptionTypes([]);
          setError(err instanceof Error ? err.message : t("lookupFailed"));
        });
    }
    if (step === 2 && countries === null) {
      getCountries()
        .then(setCountries)
        .catch((err: unknown) => {
          setCountries([]);
          setError(err instanceof Error ? err.message : t("lookupFailed"));
        });
    }
    if (step === 4 && roles === null) {
      getRoles()
        .then(setRoles)
        .catch((err: unknown) => {
          setRoles([]);
          setError(err instanceof Error ? err.message : t("lookupFailed"));
        });
    }
  }, [step, subscriptionTypes, countries, roles, t]);

  // Timezones depend on the chosen country.
  useEffect(() => {
    if (!countryId) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setTimeZones(null);
      setTimeZoneId("");
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    let cancelled = false;
    setTimeZones(null);
    setTimeZoneId("");
    getTimeZones(countryId)
      .then((rows) => {
        if (cancelled) return;
        setTimeZones(rows);
        if (rows.length === 1) setTimeZoneId(rows[0].option.id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTimeZones([]);
        setError(err instanceof Error ? err.message : t("lookupFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const finish = useCallback(async () => {
    // Surface the new account in the picker behind the wizard.
    await reloadAccounts().catch(() => undefined);
    setStep("done");
  }, [reloadAccounts]);

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
      let id = await registerNewAccount({
        accountName: name,
        adminName: adminName.trim(),
        email: adminEmail.trim(),
        subscriptionTypeId,
      });
      if (!id) {
        // The portal response didn't carry the new id — recover it from
        // the account list, which the creator's token can always see.
        const all = await getAccounts().catch(() => []);
        id = all.find((a) => a.name === name)?.id ?? null;
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
      const timeZone = timeZones?.find((tz) => tz.option.id === timeZoneId);
      if (!accountId || !country || !timeZone) return;
      await createFactory({
        accountId,
        name: factoryName.trim(),
        country,
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
  const canSubmitAccount =
    accountName.trim().length > 0 &&
    adminName.trim().length > 0 &&
    adminEmail.includes("@") &&
    subscriptionTypeId.length > 0;
  const canSubmitFactory =
    factoryName.trim().length > 0 && countryId.length > 0 && timeZoneId.length > 0;
  const canSubmitMachine = machineName.trim().length > 0;
  const canSubmitUser =
    userName.trim().length > 0 && userEmail.includes("@") && roleId.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogAria")}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-3 sm:px-4 sm:py-8"
    >
      <div className="my-auto flex w-full max-w-lg flex-col gap-4 rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 shadow-xl sm:gap-5 sm:p-6">
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
            onClick={() => !submitting && onClose()}
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
            <ProgressBar value={((stepNumber - 1) / TOTAL_STEPS) * 100} />
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
              helpText={t("adminEmailHelp")}
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              disabled={submitting}
            />
            <Select
              label={t("subscriptionLabel")}
              placeholder={
                subscriptionTypes === null ? t("loadingLookup") : undefined
              }
              value={subscriptionTypeId}
              onValueChange={setSubscriptionTypeId}
              disabled={submitting || subscriptionTypes === null}
              items={(subscriptionTypes ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              }))}
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
              placeholder={countries === null ? t("loadingLookup") : undefined}
              value={countryId}
              onValueChange={setCountryId}
              disabled={submitting || countries === null}
              items={(countries ?? []).map((c) => ({
                value: c.option.id,
                label: c.option.name,
              }))}
            />
            <Select
              label={t("timeZoneLabel")}
              placeholder={
                countryId && timeZones === null ? t("loadingLookup") : undefined
              }
              value={timeZoneId}
              onValueChange={setTimeZoneId}
              disabled={submitting || !countryId || timeZones === null}
              items={(timeZones ?? []).map((tz) => ({
                value: tz.option.id,
                label: tz.option.name,
              }))}
            />
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
              helpText={t("userEmailHelp")}
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              disabled={submitting}
            />
            <Select
              label={t("roleLabel")}
              placeholder={roles === null ? t("loadingLookup") : undefined}
              value={roleId}
              onValueChange={setRoleId}
              disabled={submitting || roles === null}
              items={(roles ?? []).map((r) => ({ value: r.id, label: r.name }))}
            />
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
