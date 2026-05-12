"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { XIcon } from "./icons";

export type PanelHeaderTone = "normal" | "hover" | "selected";

export type PanelHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  title: React.ReactNode;
  /** Render a close button on the right side. */
  onClose?: () => void;
  /** Optional content rendered between title and close button. */
  actions?: React.ReactNode;
  tone?: PanelHeaderTone;
};

/**
 * PanelHeader — matches the Figma "panel-top" component.
 *
 * Renders the top of a panel with rounded top corners, drop shadow, an
 * inset highlight stripe at the top, a bold title and an optional close X.
 *
 * The `tone` prop matches Figma states: normal (default), hover (sand),
 * selected (the same neutral as normal but with a darker border).
 */
export const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  (
    { title, onClose, actions, tone = "normal", className, ...rest },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex w-full items-center gap-[8px] rounded-t-[2px] border-x border-t px-[16px] pb-[10px] pt-[14px]",
          "drop-shadow-[0_2px_1px_rgba(0,0,0,0.1)]",
          "shadow-[var(--ds-shadow-panel-inset)]",
          tone === "hover"
            ? "bg-[var(--ds-panel-header-hover)] border-[var(--ds-grey-light-03)]"
            : tone === "selected"
              ? "bg-[var(--ds-panel-header-bg)] border-[var(--ds-grey-light-02)]"
              : "bg-[var(--ds-panel-header-bg)] border-[var(--ds-grey-light-02)]",
          className,
        )}
        {...rest}
      >
        <h3 className="flex min-w-0 flex-1 items-center font-bold text-[16px] leading-[24px] text-black">
          <span className="truncate">{title}</span>
        </h3>
        {actions}
        {onClose && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cn(
              "inline-flex h-[20px] w-[20px] items-center justify-center rounded-[2px]",
              "text-[var(--ds-grey-medium-06)] hover:bg-[var(--ds-grey-light-01)] hover:text-[var(--ds-grey-dark-09)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
            )}
          >
            <XIcon size={12} strokeWidth={2} />
          </button>
        )}
      </div>
    );
  },
);
PanelHeader.displayName = "PanelHeader";
