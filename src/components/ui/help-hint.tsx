import * as React from "react";
import { cn } from "@/lib/utils";
import { CircleQuestionIcon } from "./icons";
import { Tooltip } from "./tooltip";

export interface HelpHintProps {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  variant?: "light" | "dark";
  multiline?: boolean;
  size?: number;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * HelpHint — small "?" affordance that reveals supplemental info on hover/focus.
 * Matches the Figma help-button component (P - Opti Backoffice Components / 67:168).
 */
export function HelpHint({
  content,
  side = "top",
  variant = "dark",
  multiline = true,
  size = 20,
  className,
  disabled = false,
  ariaLabel = "More information",
}: HelpHintProps) {
  return (
    <Tooltip
      content={content}
      side={side}
      variant={variant}
      multiline={multiline}
      disabled={disabled}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        style={{ width: size, height: size }}
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "text-[var(--ds-grey-dark-09)]",
          "shadow-[0px_0.5px_1.25px_0px_rgba(0,0,0,0.3),0px_0px_0px_0.5px_rgba(0,0,0,0.05)]",
          "transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-blue,#007aff)] focus-visible:ring-offset-1",
          "disabled:text-[var(--ds-grey-light-03)] disabled:shadow-none disabled:cursor-default",
          className,
        )}
      >
        <CircleQuestionIcon size={size} />
      </button>
    </Tooltip>
  );
}
