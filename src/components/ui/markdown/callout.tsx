"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

const KIND_STYLES: Record<
  CalloutKind,
  { icon: LucideIcon; box: string; accent: string }
> = {
  note: {
    icon: Info,
    box: "border-l-[var(--ds-blue-primary)] bg-[var(--ds-blue-secondary)]",
    accent: "text-[var(--ds-blue-primary)]",
  },
  tip: {
    icon: Lightbulb,
    box: "border-l-[var(--ds-green)] bg-[var(--ds-tag-green-light)]/50",
    accent: "text-[var(--ds-green)]",
  },
  important: {
    icon: MessageSquareWarning,
    box: "border-l-[var(--ds-midnight-green)] bg-[var(--color-brand-soft)]",
    accent: "text-[var(--ds-midnight-green)]",
  },
  warning: {
    icon: TriangleAlert,
    box: "border-l-[var(--ds-orange-darkest)] bg-[var(--ds-tag-orange-light)]/60",
    accent: "text-[var(--ds-orange-darkest)]",
  },
  caution: {
    icon: OctagonAlert,
    box: "border-l-[var(--ds-red)] bg-[var(--ds-red-bg)]",
    accent: "text-[var(--ds-red)]",
  },
};

/** GitHub-alert style callout box ("> [!WARNING]" etc.) for chat answers. */
export function Callout({
  kind,
  children,
}: {
  kind: CalloutKind;
  children: ReactNode;
}) {
  const t = useTranslations("markdown.callout");
  const s = KIND_STYLES[kind];
  const Icon = s.icon;

  return (
    <div
      role="note"
      className={cn(
        "my-3 rounded-[4px] border-l-[3px] px-3 py-2",
        s.box,
      )}
    >
      <div
        className={cn(
          "mb-1 flex items-center gap-1.5 text-[13px] font-bold leading-[18px]",
          s.accent,
        )}
      >
        <Icon size={15} strokeWidth={2} aria-hidden="true" />
        <span>{t(kind)}</span>
      </div>
      <div className="text-[var(--color-foreground)] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_ol]:my-1 [&_ul]:my-1">
        {children}
      </div>
    </div>
  );
}
