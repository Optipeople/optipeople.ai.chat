"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { OptipeopleLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/auth/passwordApi";
import { cn } from "@/lib/utils";

const MIDNIGHT_GREEN = "#134343";

export function ForgotPasswordScreen() {
  const t = useTranslations("forgotPassword");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const resetUrl = `${window.location.origin}/reset-password`;
      await requestPasswordReset(email, resetUrl);
      setSent(true);
    } catch (err) {
      // Backend detail can be technical English or contradict the
      // anti-enumeration copy — keep it in the console only.
      console.error("Password reset request failed", err);
      setError(t("genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !submitting && email.length > 0;

  return (
    <div
      className="relative flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-6 sm:px-0 sm:py-0"
      style={{ backgroundColor: MIDNIGHT_GREEN }}
    >
      <form
        onSubmit={handleSubmit}
        className={cn(
          "msg-in relative w-full max-w-[400px] rounded-[4px] bg-white px-6 pt-8 pb-6 sm:px-12 sm:pt-12 sm:pb-8",
          "border border-[#aab5b5]",
          "shadow-[inset_0_2px_2px_0_rgba(0,0,0,0.1)]",
        )}
      >
        <div className="flex flex-col items-center pt-4 pb-6 sm:pt-6 sm:pb-8">
          <OptipeopleLogo
            className="h-[42px] w-auto text-[#0f1a21] sm:h-[50px]"
            aria-label="Optipeople"
          />
        </div>

        <h1 className="pb-[18px] pt-[18px] text-[21px] font-black leading-[28px] text-black/75">
          {t("heading")}
        </h1>

        {sent ? (
          <>
            <p className="pb-3 text-[14px] leading-[21px] text-black/90">
              {t.rich("sentBody", {
                email: () => <strong>{email}</strong>,
              })}
            </p>
            <p className="pb-3 text-[14px] leading-[21px] text-black/70">
              {t("sentHint")}
            </p>
            <div className="pt-3">
              <Link
                href="/"
                className="text-[14px] text-[#134343] underline decoration-solid hover:opacity-70"
              >
                {t("backToLogin")}
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="pb-3 text-[14px] leading-[21px] text-black/90">
              {t("body")}
            </p>

            <div className="flex flex-col gap-2 pb-2">
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                placeholder={t("emailPlaceholder")}
                className={cn(
                  "h-11 w-full bg-white px-[10px] py-[6px] text-[16px] leading-[21px] text-[#212529] sm:h-[30px] sm:px-[7px] sm:text-[14px]",
                  "shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.05)]",
                  "placeholder:text-[var(--ds-grey-medium-05)]",
                  "focus:outline-none focus:shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_1px_#134343]",
                  "disabled:opacity-60",
                )}
              />
            </div>

            {error && (
              <p className="mt-3 text-[13px] leading-[18px] text-[var(--color-error)]">
                {error}
              </p>
            )}

            <div className="pt-3">
              <Button type="submit" variant="secondary" disabled={!canSubmit}>
                {submitting ? (
                  <Spinner className="h-[14px] w-[14px]" />
                ) : (
                  t("submit")
                )}
              </Button>
            </div>

            <p className="pt-6 pb-3 text-[14px] leading-[21px] text-black/90">
              <Link
                href="/"
                className="text-[#134343] underline decoration-solid hover:opacity-70"
              >
                {t("backToLogin")}
              </Link>
            </p>
          </>
        )}
      </form>

      <div className="brand-stripe absolute inset-x-0 bottom-0" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
