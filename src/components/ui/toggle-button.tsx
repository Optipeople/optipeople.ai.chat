"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ToggleButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  onLabel?: string;
  offLabel?: string;
};

/**
 * ToggleButton — matches the Figma "toggle-button" component.
 *
 * A single pill that shows its current state as its label: green when on,
 * grey when off. The outer 1px offset reserves space for the raised
 * drop shadow so adjacent toggles in a row don't clip it.
 */
export const ToggleButton = React.forwardRef<
  HTMLButtonElement,
  ToggleButtonProps
>(
  (
    {
      checked,
      onCheckedChange,
      onLabel = "on",
      offLabel = "off",
      disabled,
      className,
      ...rest
    },
    ref,
  ) => {
    return (
      <div className="flex flex-col items-start pb-px pr-px">
        <button
          ref={ref}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          className={cn(
            "relative inline-flex flex-col items-center justify-center overflow-clip rounded-[2px]",
            "px-[16px] pt-[3px] pb-[2px]",
            "font-['Hanken_Grotesk',sans-serif] text-[14px] leading-[21px] text-[var(--ds-grey-dark-09)]",
            "transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            checked
              ? "bg-[var(--ds-tag-green-dark)] shadow-[0px_0.5px_2.5px_0px_rgba(0,0,0,0.35),0px_0px_0px_0.5px_rgba(0,0,0,0.1)]"
              : "bg-[var(--ds-grey-light-02)] shadow-[var(--ds-shadow-input)]",
            className,
          )}
          {...rest}
        >
          <span className="relative whitespace-nowrap">
            {checked ? onLabel : offLabel}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[inherit]",
              checked
                ? "shadow-[inset_1px_2px_2px_0px_#d0e8d3]"
                : "shadow-[inset_1px_2px_2px_0px_#ffffff]",
            )}
          />
        </button>
      </div>
    );
  },
);
ToggleButton.displayName = "ToggleButton";
