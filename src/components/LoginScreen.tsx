"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { OptipeopleLogo } from "@/components/logo";
import { useAuth } from "@/auth/AuthContext";
import type { MfaChallenge } from "@/auth/authApi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MIDNIGHT_GREEN = "#134343";

const INPUT_CLASSES = cn(
  "h-11 w-full bg-white px-[10px] py-[6px] text-[16px] leading-[21px] text-[#212529] sm:h-[30px] sm:px-[7px] sm:text-[14px]",
  "shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.05)]",
  "placeholder:text-[var(--ds-grey-medium-05)]",
  "focus:outline-none focus:shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_1px_#134343]",
  "disabled:opacity-60",
);

// Same look as the "forgotten my password" link, for in-form actions.
const LINK_CLASSES =
  "text-[#134343] underline decoration-solid hover:opacity-70 disabled:opacity-60 disabled:no-underline";

// Matches the OptiCloud portal: a new email/SMS code can be asked for
// once a minute.
const RESEND_COOLDOWN_SECONDS = 60;

function canResend(challenge: MfaChallenge) {
  return challenge.method === "email" || challenge.method === "sms";
}

export function LoginScreen() {
  const { login, isLoggingIn, loginError, mfaChallenge } = useAuth();
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await login(email, password, remember);
    } catch {
      // surfaced via loginError
    }
  }

  const canSubmit = !isLoggingIn && email.length > 0 && password.length > 0;

  return (
    <div
      className="relative flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-6 sm:px-0 sm:py-0"
      style={{ backgroundColor: MIDNIGHT_GREEN }}
    >
      {mfaChallenge ? (
        <MfaForm
          key={mfaChallenge.mfaToken}
          challenge={mfaChallenge}
          onBack={() => setPassword("")}
        />
      ) : (
        <form onSubmit={handleSubmit} className={CARD_CLASSES}>
          <CardLogo />

          <h1 className={HEADING_CLASSES}>{t("heading")}</h1>

          <div className="flex flex-col gap-2 pb-2">
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoggingIn}
              placeholder={t("emailPlaceholder")}
              className={INPUT_CLASSES}
            />
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoggingIn}
              placeholder={t("passwordPlaceholder")}
              className={INPUT_CLASSES}
            />
          </div>

          <label className="mt-2 inline-flex cursor-pointer items-center gap-[6px] text-[14px] leading-[14px] text-[#071818]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-[14px] cursor-pointer accent-[#134343]"
            />
            {t("rememberMe")}
          </label>

          {loginError && <ErrorText>{loginError}</ErrorText>}

          <div className="pt-3">
            <Button type="submit" variant="secondary" disabled={!canSubmit}>
              {isLoggingIn ? (
                <Spinner className="h-[14px] w-[14px]" />
              ) : (
                t("submit")
              )}
            </Button>
          </div>

          <p className="pt-6 pb-3 text-[14px] leading-[21px] text-black/90">
            {t("help")}
            <br aria-hidden />
            {t.rich("forgotPasswordRich", {
              link: (chunks) => (
                <Link
                  href="/forgot-password"
                  className="text-[#134343] underline decoration-solid hover:opacity-70"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </form>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-[59px]">
        <p className="flex flex-wrap items-center justify-center gap-x-9 gap-y-2 text-[14px] leading-[21px] text-[#eaeeee]">
          <a
            href="https://optipeople.com/terms-and-conditions/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {t("termsOfService")}
          </a>
        </p>
      </div>

      <div className="brand-stripe absolute inset-x-0 bottom-0" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

const CARD_CLASSES = cn(
  "msg-in relative w-full max-w-[400px] rounded-[4px] bg-white px-6 pt-8 pb-6 sm:px-12 sm:pt-12 sm:pb-8",
  "border border-[#aab5b5]",
  "shadow-[inset_0_2px_2px_0_rgba(0,0,0,0.1)]",
);

const HEADING_CLASSES =
  "pb-[18px] pt-[18px] text-[21px] font-black leading-[28px] text-black/75";

function CardLogo() {
  return (
    <div className="flex flex-col items-center pt-4 pb-6 sm:pt-6 sm:pb-8">
      <OptipeopleLogo
        className="h-[42px] w-auto text-[#0f1a21] sm:h-[50px]"
        aria-label="Optipeople"
      />
    </div>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-[13px] leading-[18px] text-[var(--color-error)]">
      {children}
    </p>
  );
}

function MfaForm({
  challenge,
  onBack,
}: {
  challenge: MfaChallenge;
  onBack: () => void;
}) {
  const { verifyMfa, resendMfaCode, cancelMfa, isLoggingIn, loginError } =
    useAuth();
  const t = useTranslations("login.mfa");
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const resendable = canResend(challenge) && !useRecoveryCode;
  // The backend sends the first email/SMS code with the challenge, so the
  // cooldown starts right away.
  const [cooldown, setCooldown] = useState(
    canResend(challenge) ? RESEND_COOLDOWN_SECONDS : 0,
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const trimmed = useRecoveryCode ? code.trim() : code.replace(/\s/g, "");
  const canSubmit = !isLoggingIn && trimmed.length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!useRecoveryCode && !/^\d{6}$/.test(trimmed)) {
      setLocalError(t("codeFormat"));
      return;
    }
    setLocalError(null);
    try {
      await verifyMfa(trimmed, useRecoveryCode);
    } catch {
      // surfaced via loginError
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    setLocalError(null);
    if (await resendMfaCode()) setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  function toggleRecovery() {
    setUseRecoveryCode((v) => !v);
    setCode("");
    setLocalError(null);
  }

  let instruction: string;
  if (useRecoveryCode) instruction = t("instructionRecovery");
  else if (challenge.method === "email")
    instruction = t("instructionEmail", {
      destination: challenge.maskedDestination ?? "",
    });
  else if (challenge.method === "sms")
    instruction = t("instructionSms", {
      destination: challenge.maskedDestination ?? "",
    });
  else instruction = t("instructionApp");

  const error = localError ?? loginError;

  return (
    <form onSubmit={handleSubmit} className={CARD_CLASSES}>
      <CardLogo />

      <h1 className={HEADING_CLASSES}>{t("heading")}</h1>

      <p className="pb-3 text-[14px] leading-[21px] text-black/90">
        {instruction}
      </p>

      <div className="flex flex-col gap-2 pb-2">
        <input
          id="mfa-code"
          type="text"
          autoComplete="one-time-code"
          inputMode={useRecoveryCode ? "text" : "numeric"}
          autoFocus
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={isLoggingIn}
          placeholder={
            useRecoveryCode ? t("recoveryPlaceholder") : t("codePlaceholder")
          }
          aria-label={
            useRecoveryCode ? t("recoveryPlaceholder") : t("codePlaceholder")
          }
          className={INPUT_CLASSES}
        />
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      <div className="pt-3">
        <Button type="submit" variant="secondary" disabled={!canSubmit}>
          {isLoggingIn ? (
            <Spinner className="h-[14px] w-[14px]" />
          ) : (
            t("submit")
          )}
        </Button>
      </div>

      <div className="flex flex-col items-start gap-1 pt-6 pb-3 text-[14px] leading-[21px]">
        {resendable && (
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || isLoggingIn}
            className={LINK_CLASSES}
          >
            {cooldown > 0
              ? t("resendIn", { seconds: cooldown })
              : t("resend")}
          </button>
        )}
        <button
          type="button"
          onClick={toggleRecovery}
          disabled={isLoggingIn}
          className={LINK_CLASSES}
        >
          {useRecoveryCode ? t("useCode") : t("useRecoveryCode")}
        </button>
        <button
          type="button"
          onClick={() => {
            cancelMfa();
            onBack();
          }}
          disabled={isLoggingIn}
          className={LINK_CLASSES}
        >
          {t("back")}
        </button>
      </div>
    </form>
  );
}
