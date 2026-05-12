"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { OptipeopleLogo } from "@/components/logo";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MIDNIGHT_GREEN = "#134343";

export function LoginScreen() {
  const { login, isLoggingIn, loginError } = useAuth();
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
      className="relative flex h-full flex-col items-center justify-center"
      style={{ backgroundColor: MIDNIGHT_GREEN }}
    >
      <form
        onSubmit={handleSubmit}
        className={cn(
          "msg-in relative w-[400px] max-w-[calc(100%-2rem)] rounded-[4px] bg-white px-12 pt-12 pb-8",
          "border border-[#aab5b5]",
          "shadow-[inset_0_2px_2px_0_rgba(0,0,0,0.1)]",
        )}
      >
        <div className="flex flex-col items-center pt-6 pb-8">
          <OptipeopleLogo
            className="h-[50px] w-auto text-[#0f1a21]"
            aria-label="Optipeople"
          />
        </div>

        <h1 className="pb-[18px] pt-[18px] text-[21px] font-black leading-[28px] text-black/75">
          Log ind
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
            placeholder="Brugernavn eller e-mail"
            className={cn(
              "h-[30px] w-full bg-white px-[7px] py-[6px] text-[14px] leading-[21px] text-[#212529]",
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
            placeholder="Adgangskode"
            className={cn(
              "h-[30px] w-full bg-white px-[7px] py-[6px] text-[14px] leading-[21px] text-[#212529]",
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
          Husk mig på denne computer
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
              "Log ind"
            )}
          </Button>
        </div>

        <p className="pt-6 pb-3 text-[14px] leading-[21px] text-black/90">
          Hjælp mig.
          <br aria-hidden />
          Jeg har{" "}
          <button
            type="button"
            className="text-[#134343] underline decoration-solid hover:opacity-70"
          >
            glemt min adgangskode
          </button>
          .
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
            Terms of Service
          </a>
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:underline"
          >
            Sprog: Dansk
          </button>
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
