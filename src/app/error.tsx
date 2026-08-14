"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle
        className="h-10 w-10 text-[var(--color-amber)]"
        aria-hidden
      />
      <h1 className="text-[20px] font-bold text-[var(--color-foreground)]">
        {t("title")}
      </h1>
      <p className="max-w-md text-[15px] leading-[1.5] text-[var(--color-muted-foreground)]">
        {t("description")}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>{t("retry")}</Button>
        <Link href="/" className={buttonClasses({ variant: "secondary" })}>
          {t("backToChat")}
        </Link>
      </div>
    </main>
  );
}
