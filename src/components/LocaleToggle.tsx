"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LocaleToggle as UiLocaleToggle } from "@optipeople/ui/blocks";
import { useAuth } from "@/auth/AuthContext";
import { locales, type Locale } from "@/i18n/config";
import { persistLocale } from "@/i18n/localeApi";

// Compact segmented toggle for switching between supported locales.
// Works for both authenticated and anonymous users: persistLocale
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
    await persistLocale(next, user?.email ?? null);
    router.refresh();
  }

  return (
    <UiLocaleToggle
      locales={locales}
      value={locale}
      onChange={(next) => void switchTo(next as Locale)}
      variant={variant}
      label={t("language")}
      className={className}
    />
  );
}
