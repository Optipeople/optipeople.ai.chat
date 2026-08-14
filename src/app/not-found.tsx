import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-[14px] font-bold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        404
      </p>
      <h1 className="text-[20px] font-bold text-[var(--color-foreground)]">
        {t("notFoundTitle")}
      </h1>
      <p className="max-w-md text-[15px] leading-[1.5] text-[var(--color-muted-foreground)]">
        {t("notFoundDescription")}
      </p>
      <Link
        href="/"
        className={buttonClasses({ className: "mt-2" })}
      >
        {t("backToChat")}
      </Link>
    </main>
  );
}
