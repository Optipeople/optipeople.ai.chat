"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/auth/AuthContext";
import { locales, type Locale } from "@/i18n/config";
import { persistLocale } from "@/i18n/localeApi";
import { cn } from "@/lib/utils";

// Compact segmented toggle for switching between supported locales.
// Works for both authenticated and anonymous users — persistLocale
// upserts the DB row when an email is available, otherwise just sets
// the cookie. Used on public pages (legal docs) where UserMenu isn't
// available because there may be no user.

export function LocaleToggle({
  className,
  variant = "light",
}: {
  className?: string;
  // "light" sits on a dark header (white text); "dark" sits on a surface
  // (foreground text). Both share the same segmented shape.
  variant?: "light" | "dark";
}) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const { user } = useAuth();
  const t = useTranslations("userMenu");

  async function switchTo(next: Locale) {
    if (next === locale) return;
    await persistLocale(next, user?.email ?? null);
    router.refresh();
  }

  const onLight = variant === "light";

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn(
        "inline-flex items-center overflow-hidden rounded-[2px]",
        onLight
          ? "bg-white/10 ring-1 ring-white/20"
          : "bg-[var(--color-muted)] ring-1 ring-[var(--color-hairline)]",
        className,
      )}
    >
      {locales.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => void switchTo(l)}
            aria-pressed={active}
            className={cn(
              "px-3 py-[5px] text-[12px] font-semibold uppercase tracking-wide leading-[14px]",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
              onLight
                ? active
                  ? "bg-white text-[var(--color-brand)]"
                  : "text-white/80 hover:text-white"
                : active
                  ? "bg-[var(--color-surface)] text-[var(--color-foreground)] shadow-[var(--ds-shadow-button)]"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
