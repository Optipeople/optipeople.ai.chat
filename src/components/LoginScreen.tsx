"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OptipeopleLogo } from "@/components/logo";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

export function LoginScreen() {
  const { login, isLoggingIn, loginError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
    } catch {
      // surfaced via loginError
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-background)]">
      <header
        className="relative z-20 shrink-0"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex h-16 max-w-3xl items-center px-6">
          <OptipeopleLogo className="h-7 w-auto text-white" aria-label="Optipeople" />
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-6">
        <form
          onSubmit={handleSubmit}
          className={cn(
            "msg-in w-full max-w-sm rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-8",
            "border border-[var(--color-hairline)] shadow-[var(--shadow-lg)]",
          )}
        >
          <h1 className="mb-1 text-[22px] font-semibold text-[var(--color-foreground)]">
            Log ind
          </h1>
          <p className="mb-6 text-[15px] text-[var(--color-muted-foreground)]">
            Brug din Optipeople-konto.
          </p>

          <label
            htmlFor="email"
            className="mb-1.5 block text-[14px] font-medium text-[var(--color-foreground)]"
          >
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoggingIn}
            className={cn(
              "mb-4 h-11 w-full rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3.5 text-[16px]",
              "border border-[var(--color-input)] text-[var(--color-foreground)]",
              "focus:border-[var(--color-brand)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]",
              "disabled:opacity-60",
            )}
          />

          <label
            htmlFor="password"
            className="mb-1.5 block text-[14px] font-medium text-[var(--color-foreground)]"
          >
            Adgangskode
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoggingIn}
            className={cn(
              "mb-5 h-11 w-full rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3.5 text-[16px]",
              "border border-[var(--color-input)] text-[var(--color-foreground)]",
              "focus:border-[var(--color-brand)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]",
              "disabled:opacity-60",
            )}
          />

          {loginError && (
            <p className="mb-4 text-[14px] text-[#b00020]">{loginError}</p>
          )}

          <Button
            type="submit"
            disabled={isLoggingIn || !email || !password}
            className="h-11 w-full rounded-[var(--radius-sm)]"
          >
            {isLoggingIn ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              "Log ind"
            )}
          </Button>
        </form>
      </div>

      <div className="brand-stripe" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
