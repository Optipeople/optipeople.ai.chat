import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { Markdown } from "@/components/ui/markdown";
import { OptipeopleLogo } from "@/components/logo";
import { isLocale } from "@/i18n/config";
import { isLegalDocId, loadLegalDoc } from "@/lib/legalDocs";

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
    <div className="min-h-screen bg-[var(--color-background)]">
      <header
        className="relative z-20 shrink-0"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <OptipeopleLogo
            className="h-6 w-auto shrink-0 text-white sm:h-7"
            aria-label="Optipeople"
          />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <Markdown>{content.body}</Markdown>
      </main>
    </div>
  );
}
