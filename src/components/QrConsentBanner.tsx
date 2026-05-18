"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { getQrToken } from "@/auth/qrStorage";
import { Button } from "@/components/ui/button";
import { TERMS_VERSION } from "@/lib/consent";
import { cn } from "@/lib/utils";

// Anonymous operators arriving via QR sticker have no Optipeople login,
// so we can't record per-user acceptance. Legal accountability sits
// with the factory account that provisioned the QR code under the
// master contract. The banner is therefore just a notice — read once,
// dismiss, persisted per (qr-token, terms-version) so a bumped version
// re-prompts the same device.

const STORAGE_PREFIX = "optiai_qr_consent_ack__";

function ackKey(token: string): string {
  return `${STORAGE_PREFIX}${token}__${TERMS_VERSION}`;
}

export function QrConsentBanner() {
  const t = useTranslations("consent.qrBanner");
  const tc = useTranslations("common");

  // null = haven't checked storage yet; false = needs banner; true = ack'd.
  // Tracking the third state avoids a flash of banner on first paint
  // when the user has actually already dismissed it on this device.
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);

  useEffect(() => {
    // localStorage is browser-only — initial render starts in the "checking"
    // state and the effect promotes it once we can read the cached ack.
    /* eslint-disable react-hooks/set-state-in-effect */
    const token = getQrToken();
    if (!token) {
      setAcknowledged(true);
      return;
    }
    const prior = window.localStorage.getItem(ackKey(token));
    setAcknowledged(prior === "1");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function dismiss() {
    const token = getQrToken();
    if (token) {
      window.localStorage.setItem(ackKey(token), "1");
    }
    setAcknowledged(true);
  }

  if (acknowledged !== false) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("ariaLabel")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6 sm:pb-6",
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-3xl flex-col gap-3 rounded-[4px] p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5",
          "border-2 border-[var(--ds-grey-light-02)] bg-[var(--color-surface)] shadow-[var(--ds-shadow-destructive)]",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--color-foreground)] sm:text-[15px]">
            {t("title")}
          </p>
          <p className="mt-1 text-[13px] leading-[1.55] text-[var(--color-muted-foreground)] sm:text-[14px]">
            {t.rich("body", {
              terms: (chunks) => (
                <a
                  href="/legal/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[var(--color-brand)] underline underline-offset-2"
                >
                  {chunks}
                </a>
              ),
              privacy: (chunks) => (
                <a
                  href="/legal/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[var(--color-brand)] underline underline-offset-2"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" onClick={dismiss}>
            {t("acknowledge")}
          </Button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={tc("close")}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-[2px]",
              "text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)]",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
