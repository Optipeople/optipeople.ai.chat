"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CircleXIcon, SearchIcon } from "./icons";

export type SearchFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "type"
> & {
  size?: "small" | "medium";
  /** Render an X clear button when the field has a value. */
  clearable?: boolean;
  onClear?: () => void;
};

const SIZE_STYLES = {
  small: "h-[30px] gap-[5px] py-[6px] pl-[7px] pr-[7px]",
  medium: "h-[42px] gap-[7px] py-[6px] pl-[14px] pr-[7px] min-w-[200px]",
} as const;

/**
 * SearchField — matches the Figma "search-field" component.
 *
 * A self-contained input with a magnifying-glass icon on the left and an
 * optional clear button on the right that appears when there is a value.
 * Focus state gets the design system's green focus ring.
 */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    {
      size = "small",
      clearable = true,
      onClear,
      disabled,
      value,
      defaultValue,
      className,
      placeholder = "Search",
      onChange,
      ...rest
    },
    ref,
  ) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
    const [focused, setFocused] = React.useState(false);
    const currentValue = value !== undefined ? value : internalValue;
    const hasValue = String(currentValue ?? "").length > 0;

    const innerRef = React.useRef<HTMLInputElement | null>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    const handleClear = () => {
      if (value === undefined) setInternalValue("");
      onClear?.();
      innerRef.current?.focus();
    };

    return (
      <div
        data-focused={focused ? "" : undefined}
        className={cn(
          "relative flex w-full items-center overflow-hidden rounded-[4px]",
          "shadow-[var(--ds-shadow-input)]",
          disabled
            ? "bg-[var(--ds-grey-light-01)]"
            : focused
              ? "bg-white shadow-[var(--ds-shadow-input),var(--ds-focus-ring)]"
              : "bg-white",
          SIZE_STYLES[size],
          className,
        )}
      >
        <SearchIcon
          size={16}
          className={cn(
            "shrink-0",
            hasValue
              ? "text-[var(--ds-grey-dark-09)]"
              : "text-[var(--ds-text-disabled)]",
          )}
        />
        <input
          ref={innerRef}
          type="search"
          disabled={disabled}
          value={value}
          defaultValue={defaultValue}
          placeholder={placeholder}
          onChange={(e) => {
            if (value === undefined) setInternalValue(e.target.value);
            onChange?.(e);
          }}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none",
            "font-['Hanken_Grotesk',sans-serif] font-normal text-[14px] leading-[14px]",
            hasValue
              ? "text-[var(--ds-grey-dark-09)]"
              : "text-[var(--ds-text-disabled)]",
            "placeholder:text-[var(--ds-text-disabled)]",
            "disabled:cursor-not-allowed",
          )}
          {...rest}
        />
        {clearable && hasValue && !disabled && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={handleClear}
            className="ml-auto inline-flex shrink-0 items-center justify-center text-[var(--ds-grey-medium-05)] hover:text-[var(--ds-grey-dark-09)]"
          >
            <CircleXIcon size={16} />
          </button>
        )}
      </div>
    );
  },
);
SearchField.displayName = "SearchField";
