"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/auth/authApi";
import { cn } from "@/lib/utils";

export type SourceRef = {
  id: string;
  title: string;
  pageFrom: number | null;
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
  const tChat = useTranslations("chat");
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (loading) return;
    setError(null);
    setLoading(true);
    const popup =
      typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      const res = await fetchWithAuth(
        `/api/documents/${encodeURIComponent(source.id)}/url`,
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Server error ${res.status}${txt ? `: ${txt}` : ""}`);
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) throw new Error(tChat("missingUrl"));
      const target =
        source.pageFrom != null
          ? `${body.url}#page=${source.pageFrom}`
          : body.url;
      if (popup) popup.location.href = target;
      else window.open(target, "_blank");
    } catch (err: unknown) {
      if (popup) popup.close();
      setError(err instanceof Error ? err.message : tChat("openDocFailed"));
    } finally {
      setLoading(false);
    }
  }

  const pageLabel =
    source.pageFrom != null ? ` · ${tCommon("page", { n: source.pageFrom })}` : "";

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      title={error ?? tCommon("openInNewTab", { title: `${source.title}${pageLabel}` })}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface)] px-3 py-1 text-[12px] text-[var(--color-foreground)]",
        "border border-[var(--color-hairline)] shadow-[var(--shadow-sm)]",
        "transition-colors hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-muted)]/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        "disabled:opacity-60",
        error && "border-red-300 text-red-700",
      )}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <FileText className="h-3 w-3" />
      )}
      <span className="max-w-[260px] truncate">{source.title}</span>
      {source.pageFrom != null && (
        <span className="text-[var(--color-muted-foreground)]">
          {tCommon("page", { n: source.pageFrom })}
        </span>
      )}
      <ExternalLink className="h-3 w-3 text-[var(--color-muted-foreground)]" />
    </button>
  );
}
