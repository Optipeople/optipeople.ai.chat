"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  CircleCheckIcon,
  CircleExclamationIcon,
  CircleInfoIcon,
  XIcon,
} from "./icons";

export type TagVariant = "default" | "positive" | "warning" | "issue";
export type TagSize = "small" | "medium";

export type TagProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> & {
  variant?: TagVariant;
  size?: TagSize;
  showIcon?: boolean;
  /** If provided, an X button is rendered after the label. */
  onRemove?: () => void;
};

const VARIANT_STYLES: Record<
  TagVariant,
  { bg: string; border: string; icon?: React.ReactNode }
> = {
  default: {
    bg: "bg-[var(--ds-blue-secondary)]",
    border: "border-[var(--ds-grey-light-03)]",
  },
  positive: {
    bg: "bg-[var(--ds-tag-green-light)]",
    border: "border-[var(--ds-tag-green-dark)]",
    icon: <CircleCheckIcon size={12} className="text-[var(--ds-green)]" />,
  },
  warning: {
    bg: "bg-[var(--ds-tag-orange-light)]",
    border: "border-[var(--ds-tag-orange-dark)]",
    icon: <CircleInfoIcon size={12} className="text-[var(--ds-orange)]" />,
  },
  issue: {
    bg: "bg-[var(--ds-tag-red-light)]",
    border: "border-[var(--ds-tag-red-dark)]",
    icon: <CircleExclamationIcon size={12} className="text-[var(--ds-red)]" />,
  },
};

/** Tag — matches the Figma "tags" component (default, positive, warning, issue). */
export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  (
    {
      className,
      variant = "default",
      size = "medium",
      showIcon = false,
      onRemove,
      children,
      ...rest
    },
    ref,
  ) => {
    const v = VARIANT_STYLES[variant];
    const isStatus = variant !== "default";

    return (
      <span
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center rounded-[3px] border-[0.5px]",
          "shadow-[var(--ds-shadow-tag-inset)]",
          "text-[var(--ds-grey-medium-06)]",
          v.bg,
          v.border,
          size === "small"
            ? "h-[18px] gap-[6px] px-[9px] py-[5px] font-black uppercase text-[10px] leading-[14px] tracking-[0.02em]"
            : "gap-[6px] px-[10px] py-[4px] font-bold text-[14px] leading-[16px]",
          className,
        )}
        {...rest}
      >
        {showIcon && isStatus && size === "medium" && v.icon}
        <span className="whitespace-nowrap">{children}</span>
        {onRemove && (
          <button
            type="button"
            aria-label="Remove"
            onClick={onRemove}
            className="ml-[2px] inline-flex h-[12px] w-[12px] items-center justify-center text-[var(--ds-grey-medium-06)] hover:text-[var(--ds-grey-dark-09)]"
          >
            <XIcon size={10} />
          </button>
        )}
      </span>
    );
  },
);
Tag.displayName = "Tag";
