"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type SpinnerProps = Omit<
  React.SVGAttributes<SVGSVGElement>,
  "viewBox" | "fill" | "role"
>;

/**
 * Spinner — matches the Figma "loading spinner" component.
 * Sizes via className (e.g. "h-5 w-5") like a Lucide icon.
 */
export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, "aria-label": ariaLabel = "Loading", ...rest }, ref) => {
    const id = React.useId();
    return (
      <svg
        ref={ref}
        viewBox="0 0 48 48"
        fill="none"
        role="status"
        aria-label={ariaLabel}
        className={cn("animate-spin", className)}
        {...rest}
      >
        <defs>
          <linearGradient
            id={id}
            x1="24"
            y1="4"
            x2="24"
            y2="44"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#243535" />
            <stop offset="100%" stopColor="#eaeeee" />
          </linearGradient>
        </defs>
        <path
          d="M 24 4 a 20 20 0 1 1 -0.01 0"
          stroke={`url(#${id})`}
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    );
  },
);
Spinner.displayName = "Spinner";
