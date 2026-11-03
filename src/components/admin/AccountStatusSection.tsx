"use client";

// Partner and trial flags for one account (table account_flags). Shown
// to super admins and partners only. Default, with nothing set, is a
// paying, active customer account.
//
// Trial is informational: nothing is blocked when it ends. Only super
// admins (not partners) can mark a partner account, and a partner
// account can never be on trial.

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { isStrictSuperAdmin, useAuth } from "@/auth/AuthContext";
import {
  adminErrorMessage,
  getAccountFlags,
  updateAccountFlags,
  type AccountFlags,
} from "@/admin/adminApi";
import { TrialTag } from "@/components/admin/TrialTag";
import { defaultTrialEnd } from "@/lib/trialDates";

export function AccountStatusSection({ accountId }: { accountId: string }) {
  const t = useTranslations("admin.accountStatus");
  const tErr = useTranslations("admin.apiErrors");
  const tc = useTranslations("common");
  const format = useFormatter();
  const { user, accounts } = useAuth();
  const strict = isStrictSuperAdmin(user);
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? null;

  const [flags, setFlags] = useState<AccountFlags | null>(null);
  const [endsDraft, setEndsDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccountFlags(accountId)
      .then((f) => {
        if (cancelled) return;
        setFlags(f);
        setEndsDraft(f.trialEndsAt ?? "");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, tErr, tc]);

  async function save(patch: {
    isPartner?: boolean;
    trialEndsAt?: string | null;
  }) {
    setSaving(true);
    setError(null);
    try {
      const next = await updateAccountFlags(accountId, {
        ...patch,
        accountName,
      });
      setFlags(next);
      setEndsDraft(next.trialEndsAt ?? "");
    } catch (err) {
      setError(adminErrorMessage(err, tErr) ?? tc("unknownError"));
    } finally {
      setSaving(false);
    }
  }

  if (flags === null) {
    return error ? (
      <ErrorBox>{error}</ErrorBox>
    ) : (
      <div className="flex h-24 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const onTrial = flags.trialEndsAt !== null;
  const draftValid = /^\d{4}-\d{2}-\d{2}$/.test(endsDraft);
  const draftChanged = endsDraft !== (flags.trialEndsAt ?? "");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Checkbox
          label={t("trialLabel")}
          checked={onTrial}
          disabled={saving || flags.isPartner}
          onChange={(e) =>
            void save({
              trialEndsAt: e.target.checked ? defaultTrialEnd() : null,
            })
          }
        />
        <p className="text-[13px] text-[var(--color-muted-foreground)]">
          {flags.isPartner ? t("partnerBlocksTrial") : t("trialHelp")}
        </p>
        {onTrial && (
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex flex-wrap items-end gap-3">
              <TextField
                type="date"
                label={t("trialEndsLabel")}
                value={endsDraft}
                onChange={(e) => setEndsDraft(e.target.value)}
                disabled={saving}
                className="w-48"
              />
              <Button
                variant="secondary"
                size="compact"
                disabled={saving || !draftValid || !draftChanged}
                onClick={() => void save({ trialEndsAt: endsDraft })}
              >
                {t("save")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <TrialTag trialEndsAt={flags.trialEndsAt} showExpired={strict} />
              {flags.trialSetAt && (
                <span className="text-[13px] text-[var(--color-muted-foreground)]">
                  {t("trialSetBy", {
                    name: flags.trialSetByName ?? flags.trialSetByEmail ?? "",
                    date: format.dateTime(new Date(flags.trialSetAt), {
                      dateStyle: "medium",
                    }),
                  })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <hr className="border-0 border-t border-[var(--ds-grey-light-02)]" />

      <div className="flex flex-col gap-2">
        <Checkbox
          label={t("partnerLabel")}
          checked={flags.isPartner}
          disabled={saving || !strict || onTrial}
          onChange={(e) => void save({ isPartner: e.target.checked })}
        />
        <p className="text-[13px] text-[var(--color-muted-foreground)]">
          {!strict
            ? t("partnerSuperOnly")
            : onTrial
              ? t("trialBlocksPartner")
              : t("partnerHelp")}
        </p>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-4 text-[14px] text-[var(--ds-red-dark)]">
      {children}
    </div>
  );
}
