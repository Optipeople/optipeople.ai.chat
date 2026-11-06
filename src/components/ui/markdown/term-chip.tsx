"use client";

import type { ReactNode } from "react";
import {
  Database,
  Factory,
  Gauge,
  Package,
  Siren,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type TermKind =
  | "machine"
  | "alarm"
  | "part"
  | "param"
  | "value"
  | "button"
  | "data";

const TERM_KINDS: readonly TermKind[] = [
  "machine",
  "alarm",
  "part",
  "param",
  "value",
  "button",
  "data",
];

export function isTermKind(s: string): s is TermKind {
  return (TERM_KINDS as readonly string[]).includes(s);
}

const KIND_STYLES: Record<
  Exclude<TermKind, "button">,
  { icon: LucideIcon; chip: string; iconClass: string }
> = {
  machine: {
    icon: Factory,
    chip: "bg-[var(--color-brand-soft)] text-[var(--ds-midnight-green)]",
    iconClass: "text-[var(--ds-midnight-green)]",
  },
  alarm: {
    icon: Siren,
    chip: "bg-[var(--ds-red-bg)] text-[var(--ds-red-dark)]",
    iconClass: "text-[var(--ds-red)]",
  },
  part: {
    icon: Package,
    chip: "bg-[var(--color-muted)] text-[var(--color-foreground)]",
    iconClass: "text-[var(--color-muted-foreground)]",
  },
  param: {
    icon: SlidersHorizontal,
    chip: "bg-[var(--ds-blue-secondary)] text-[var(--ds-grey-dark-09)] font-mono",
    iconClass: "text-[var(--ds-blue-primary)]",
  },
  value: {
    icon: Gauge,
    chip: "bg-[var(--ds-blue-secondary)] text-[var(--ds-grey-dark-09)] font-mono tabular-nums",
    iconClass: "text-[var(--ds-blue-primary)]",
  },
  data: {
    icon: Database,
    chip: "bg-[var(--color-muted)] text-[var(--color-foreground)]",
    iconClass: "text-[var(--color-muted-foreground)]",
  },
};

const BASE =
  "inline-flex items-baseline gap-[0.3em] rounded-[3px] px-1.5 align-baseline text-[0.9em] font-medium leading-[1.35]";

/** Inline semantic chip for machine terms inside prose. */
export function TermChip({
  kind,
  children,
}: {
  kind: TermKind;
  children: ReactNode;
}) {
  if (kind === "button") {
    return (
      <kbd
        className={cn(
          BASE,
          "border border-b-2 border-[var(--color-border)] bg-[var(--color-surface)] font-sans text-[0.75em] font-semibold uppercase tracking-[0.03em] text-[var(--color-foreground)]",
        )}
      >
        {children}
      </kbd>
    );
  }

  const s = KIND_STYLES[kind];
  const Icon = s.icon;
  return (
    <span className={cn(BASE, s.chip)}>
      <Icon
        aria-hidden="true"
        strokeWidth={2}
        className={cn("size-[0.95em] shrink-0 self-center", s.iconClass)}
      />
      <span>{children}</span>
    </span>
  );
}
