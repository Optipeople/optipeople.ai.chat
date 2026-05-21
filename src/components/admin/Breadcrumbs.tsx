"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = {
  label: string;
  href?: string;
  // Renders italic + dimmed while the real label is loading. Allows a
  // page to show the breadcrumb structure immediately and fill in
  // entity names (machine, account) once their fetch resolves.
  loading?: boolean;
};

export function Breadcrumbs({
  items,
  className,
}: {
  items: Crumb[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[13px] text-[var(--color-muted-foreground)]",
        className,
      )}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const labelClass = cn(
          "max-w-[60vw] truncate sm:max-w-[28ch]",
          item.loading && "italic opacity-60",
          isLast && !item.loading && "text-[var(--color-foreground)]",
        );
        return (
          <span key={i} className="flex min-w-0 items-center gap-1">
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className={cn(labelClass, "hover:text-[var(--color-foreground)]")}
              >
                {item.label}
              </Link>
            ) : (
              <span className={labelClass} aria-current={isLast ? "page" : undefined}>
                {item.label}
              </span>
            )}
            {!isLast && (
              <ChevronRight
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 opacity-60"
              />
            )}
          </span>
        );
      })}
    </nav>
  );
}
