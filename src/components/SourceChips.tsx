"use client";

import { useTranslations } from "next-intl";
import { ExternalLink, FileText } from "lucide-react";
import { useFileViewer } from "@/components/FileViewer";
import { cn } from "@/lib/utils";

export type SourceRef = {
  id: string;
  title: string;
  pageFrom: number | null;
  // Fleet chats only: which machine the document belongs to. Absent in
  // machine-scoped chats, where it would be redundant.
  machineName?: string;
};

export function SourceChips({ sources }: { sources: SourceRef[] }) {
  const t = useTranslations("chat");
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {t("sources")}
      </span>
      {sources.map((s) => (
        <SourceChip key={s.id} source={s} />
      ))}
    </div>
  );
}

function SourceChip({ source }: { source: SourceRef }) {
  const tCommon = useTranslations("common");
  const viewer = useFileViewer();

  const pageLabel =
    source.pageFrom != null ? ` · ${tCommon("page", { n: source.pageFrom })}` : "";

  return (
    <button
      type="button"
      onClick={() =>
        viewer.open({
          kind: "doc",
          id: source.id,
          title: source.title,
          page: source.pageFrom,
        })
      }
      title={tCommon("openInNewTab", { title: `${source.title}${pageLabel}` })}
      className={cn(
        "tap-target inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--color-surface)] px-3 py-1 text-[12px] text-[var(--color-foreground)]",
        "border border-[var(--color-hairline)] shadow-[var(--shadow-sm)]",
        "transition-colors hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-muted)]/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
      )}
    >
      <FileText className="h-3 w-3 shrink-0" />
      <span className="min-w-0 max-w-[180px] truncate sm:max-w-[260px]">
        {source.title}
      </span>
      {source.machineName && (
        <span className="max-w-[120px] shrink-0 truncate text-[var(--color-muted-foreground)]">
          {source.machineName}
        </span>
      )}
      {source.pageFrom != null && (
        <span className="shrink-0 text-[var(--color-muted-foreground)]">
          {tCommon("page", { n: source.pageFrom })}
        </span>
      )}
      <ExternalLink className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
    </button>
  );
}
