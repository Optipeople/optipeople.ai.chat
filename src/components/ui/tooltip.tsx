import * as React from "react";
import { cn } from "@/lib/utils";

type TooltipSide = "top" | "bottom" | "left" | "right";
type TooltipVariant = "light" | "dark";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: TooltipSide;
  variant?: TooltipVariant;
  /** Limit width to ~200px and allow wrapping (matches Figma multiline). */
  multiline?: boolean;
  /** Render in a wrapping span that fills its container. */
  className?: string;
  /** Suppress the tooltip without removing surrounding markup. */
  disabled?: boolean;
}

const sideClasses: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-[6px]",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-[6px]",
  left: "right-full top-1/2 -translate-y-1/2 mr-[6px]",
  right: "left-full top-1/2 -translate-y-1/2 ml-[6px]",
};

/**
 * Tooltip — matches the Figma "tooltip" component
 * (P - Opti Backoffice Components / 809:300).
 *
 * Light/dark surfaces, single-line by default, optional multiline (max 200px).
 * Appears on hover and keyboard focus of the wrapped child.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  variant = "dark",
  multiline = false,
  className,
  disabled = false,
}: TooltipProps) {
  if (disabled || content == null || content === "") {
    return children;
  }

  const isDark = variant === "dark";

  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 select-none",
          "rounded-[2px] px-[12px] py-[6px]",
          "font-['Hanken_Grotesk',sans-serif] text-[14px] font-normal leading-[14px]",
          "shadow-[var(--ds-shadow-button)]",
          "opacity-0 transition-opacity duration-150",
          "group-hover:opacity-100 group-focus-within:opacity-100",
          isDark
            ? "bg-[var(--ds-grey-dark-08)] text-[var(--ds-grey-light-01)]"
            : "bg-[var(--ds-grey-light-02)] text-[var(--ds-grey-dark-09)]",
          multiline
            ? "w-max max-w-[200px] whitespace-normal [word-break:break-word]"
            : "whitespace-nowrap",
          sideClasses[side],
        )}
      >
        {content}
      </span>
    </span>
  );
}
