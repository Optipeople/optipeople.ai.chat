"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { OptipeopleLogo } from "@/components/logo";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MIDNIGHT_GREEN = "#134343";

export function LoginScreen() {
  const { login, isLoggingIn, loginError } = useAuth();
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
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
            className={cn(
              "h-11 w-full bg-white px-[10px] py-[6px] text-[16px] leading-[21px] text-[#212529] sm:h-[30px] sm:px-[7px] sm:text-[14px]",
              "shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.05)]",
              "placeholder:text-[#b9b8b7]",
              "focus:outline-none focus:shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_1px_#134343]",
              "disabled:opacity-60",
            )}
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
            className={cn(
              "h-11 w-full bg-white px-[10px] py-[6px] text-[16px] leading-[21px] text-[#212529] sm:h-[30px] sm:px-[7px] sm:text-[14px]",
              "shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.05)]",
              "placeholder:text-[#b9b8b7]",
              "focus:outline-none focus:shadow-[0_0.5px_2.5px_0_rgba(0,0,0,0.3),0_0_0_1px_#134343]",
              "disabled:opacity-60",
            )}
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

        {loginError && (
          <p className="mt-3 text-[13px] leading-[18px] text-[#b00020]">
            {loginError}
          </p>
        )}

        <div className="pt-3">
          <Button type="submit" variant="secondary" disabled={!canSubmit}>
            {isLoggingIn ? (
              <Loader2 className="h-[14px] w-[14px] animate-spin" />
            ) : (
              t("submit")
            )}
          </Button>
        </div>

        <p className="pt-6 pb-3 text-[14px] leading-[21px] text-black/90">
          {t("help")}
          <br aria-hidden />
          {t("forgotPasswordPrefix")}
          <button
            type="button"
            className="text-[#134343] underline decoration-solid hover:opacity-70"
          >
            {t("forgotPassword")}
          </button>
          {t("forgotPasswordSuffix")}
        </p>
      </form>

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
