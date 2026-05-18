import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { LocaleToggle } from "@/components/LocaleToggle";
import { Markdown } from "@/components/ui/markdown";
import { OptipeopleLogo } from "@/components/logo";
import { isLocale } from "@/i18n/config";
import { isLegalDocId, loadLegalDoc } from "@/lib/legalDocs";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LegalDocPage({
  params,
}: {
  params: Promise<{ doc: string }>;
}) {
  const { doc } = await params;
  if (!isLegalDocId(doc)) notFound();

  const rawLocale = await getLocale();
  const locale = isLocale(rawLocale) ? rawLocale : "en";

  const content = await loadLegalDoc(doc, locale);
  if (!content) notFound();

  return (
    <div className="flex min-h-full flex-col bg-[var(--color-background)]">
      <header
        className="relative z-20 shrink-0"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <OptipeopleLogo
            className="h-6 w-auto shrink-0 text-white sm:h-7"
            aria-label="Optipeople"
          />
          <LocaleToggle variant="light" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <article
          className={cn(
            "msg-in rounded-[4px] bg-[var(--color-surface)] p-6 sm:p-10",
            "border-2 border-[var(--ds-grey-light-02)] shadow-[var(--ds-shadow-destructive)]",
          )}
        >
          <Markdown className="text-[15px] leading-[1.65] sm:text-[16px] sm:leading-[1.7]">
            {content.body}
          </Markdown>
        </article>
      </main>

      <div className="brand-stripe" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
