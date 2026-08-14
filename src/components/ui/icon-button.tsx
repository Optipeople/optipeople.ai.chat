import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Icon-only button — codifies the 32×32 hover-pill recipe that already
 * ships on the chat message actions (copy / speak / regenerate) and the
 * admin tree row actions. Not a new design.
 *
 * - `aria-label` is required: an icon-only control has no text fallback.
 * - Includes `.tap-target`, so on touch devices the hit area is extended
 *   to 44×44px without changing the visual size.
 */
export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "tap-target inline-flex h-8 w-8 items-center justify-center rounded-md",
        "text-[var(--color-muted-foreground)] transition-colors",
        "hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        "disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
