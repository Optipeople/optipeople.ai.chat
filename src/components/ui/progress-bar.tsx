"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ProgressBarSize = "regular" | "large";

export type ProgressBarProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "role" | "aria-valuemin" | "aria-valuemax" | "aria-valuenow"
> & {
  /** 0–100. Clamped. */
  value: number;
  size?: ProgressBarSize;
};

/** ProgressBar — matches the Figma "progress bar" component (regular 3px, large 12px). */
export const ProgressBar = React.forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ value, size = "regular", className, ...rest }, ref) => {
    const pct = Math.min(Math.max(value, 0), 100);
    const isLarge = size === "large";
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className={cn(
          "relative w-full overflow-hidden rounded-[1px] bg-[rgba(0,0,0,0.05)]",
          isLarge ? "h-[12px]" : "h-[3px]",
          className,
        )}
        {...rest}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-[1px] bg-[var(--ds-midnight-green)] transition-[width] duration-200",
            isLarge && "shadow-[inset_0px_4px_4px_0px_rgba(0,0,0,0.25)]",
          )}
          style={{ width: `${pct}%` }}
        />
        {!isLarge && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0px_1px_2px_0px_rgba(0,0,0,0.02),inset_0px_0px_2px_0px_rgba(0,0,0,0.03),inset_0px_0px_2px_0px_rgba(0,0,0,0.04)]"
          />
        )}
      </div>
    );
  },
);
ProgressBar.displayName = "ProgressBar";
