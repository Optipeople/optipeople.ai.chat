"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, ChevronRightIcon } from "./icons";

export type SectionExpanderProps = {
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  /** Optional content rendered below the header when expanded. */
  panel?: React.ReactNode;
  /**
   * Keep the panel mounted (hidden via CSS) after its first expand so
   * its internal data fetches happen once and don't re-run each time
   * the user re-opens the section. The panel is not mounted at all
   * until the section has been expanded once — collapsed sections
   * shouldn't fetch. Defaults to false.
   */
  keepMounted?: boolean;
};

/**
 * SectionExpander — matches the Figma "section-expander" component.
 *
 * Collapsed: light blue table-hover background, chevron-right.
 * Expanded (default): same light bg with chevron-down.
 * Expanded hover: orange. Expanded pressed/active: dark orange.
 */
export function SectionExpander({
  expanded,
  onToggle,
  children,
  className,
  panel,
  keepMounted = false,
}: SectionExpanderProps) {
  const [hasExpanded, setHasExpanded] = React.useState(expanded);
  if (expanded && !hasExpanded) setHasExpanded(true);
  return (
    <div className={cn("w-full", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center justify-center gap-[6px] border-b pb-[6px] pt-[10px] transition-colors",
          "text-left text-[14px] leading-[16px] font-bold text-[rgba(0,0,0,0.9)]",
          expanded
            ? "bg-[var(--ds-table-blue-hover)] border-[var(--ds-grey-light-03)] px-[10px] hover:bg-[var(--ds-orange)] active:bg-[var(--ds-orange-darkest)] hover:border-[var(--ds-grey-light-03)]"
            : "bg-[var(--ds-table-blue-hover)] border-[var(--ds-grey-light-02)] pl-[16px] pr-[10px] hover:bg-[var(--ds-orange)] active:bg-[var(--ds-orange-darkest)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
        )}
      >
        {expanded ? (
          <ChevronDownIcon size={12} strokeWidth={2.5} />
        ) : (
          <ChevronRightIcon size={10} strokeWidth={2.5} />
        )}
        <span className="flex-1">{children}</span>
      </button>
      {keepMounted
        ? panel != null &&
          hasExpanded && <div hidden={!expanded}>{panel}</div>
        : expanded && panel}
    </div>
  );
}
