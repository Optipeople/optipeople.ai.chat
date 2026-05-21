"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { OptipeopleLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { setNewPassword } from "@/auth/passwordApi";
import { cn } from "@/lib/utils";

const MIDNIGHT_GREEN = "#134343";
const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordScreen() {
  const t = useTranslations("resetPassword");
  const params = useSearchParams();

  // The reset email links back with token + email as query params. Names
  // mirror the swagger schema for SetNewForgottenPassword. Fall back to
  // common alternates the backend might use to be tolerant of casing.
  const token =
    params.get("token") ?? params.get("Token") ?? params.get("code") ?? "";
  const email =
    params.get("email") ?? params.get("Email") ?? params.get("user") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const linkInvalid = !token || !email;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("tooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await setNewPassword({ token, email, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !submitting && password.length > 0 && confirm.length > 0 && !linkInvalid;

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

        {done ? (
          <>
            <p className="pb-3 text-[14px] leading-[21px] text-black/90">
              {t("doneBody")}
            </p>
            <div className="pt-3">
              <Link
                href="/"
                className="text-[14px] text-[#134343] underline decoration-solid hover:opacity-70"
              >
                {t("toLogin")}
              </Link>
            </div>
          </>
        ) : linkInvalid ? (
          <>
            <p className="pb-3 text-[14px] leading-[21px] text-[#b00020]">
              {t("linkInvalid")}
            </p>
            <p className="pb-3 text-[14px] leading-[21px] text-black/70">
              {t("linkInvalidHint")}
            </p>
            <div className="pt-3">
              <Link
                href="/forgot-password"
                className="text-[14px] text-[#134343] underline decoration-solid hover:opacity-70"
              >
                {t("requestNew")}
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="pb-3 text-[14px] leading-[21px] text-black/90">
              {t.rich("body", {
                email: () => <strong>{email}</strong>,
              })}
            </p>

            <div className="flex flex-col gap-2 pb-2">
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                placeholder={t("passwordPlaceholder")}
                className={cn(
                  "h-11 w-full bg-white px-[10px] py-[6px] text-[16px] leading-[21px] text-[#212529] sm:h-[30px] sm:px-[7px] sm:text-[14px]",
                  "shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.05)]",
                  "placeholder:text-[#b9b8b7]",
                  "focus:outline-none focus:shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_1px_#134343]",
                  "disabled:opacity-60",
                )}
              />
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={submitting}
                placeholder={t("confirmPlaceholder")}
                className={cn(
                  "h-11 w-full bg-white px-[10px] py-[6px] text-[16px] leading-[21px] text-[#212529] sm:h-[30px] sm:px-[7px] sm:text-[14px]",
                  "shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.05)]",
                  "placeholder:text-[#b9b8b7]",
                  "focus:outline-none focus:shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_1px_#134343]",
                  "disabled:opacity-60",
                )}
              />
            </div>

            {error && (
              <p className="mt-3 text-[13px] leading-[18px] text-[#b00020]">
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
