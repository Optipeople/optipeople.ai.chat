"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CheckIcon, MinusIcon } from "./icons";

export type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "type"
> & {
  label?: React.ReactNode;
  indeterminate?: boolean;
  /** Render inside a table cell (row stripe, no label slot). */
  table?: boolean;
};

/**
 * Checkbox — matches the Figma "check-box" component.
 *
 * Visuals:
 *  - Unchecked: white box with subtle inner shadow + 0.5px black-25% border.
 *  - Checked / indeterminate: dark-teal fill (brand-7) with white glyph.
 *  - Disabled: greyed fill / border, no pointer events.
 *  - Table variant: 100px-wide cell with row tint; checked rows pick up the
 *    blue table-hover background per Figma.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      label,
      indeterminate,
      disabled,
      checked,
      defaultChecked,
      table,
      id,
      ...rest
    },
    ref,
  ) => {
    const internalRef = React.useRef<HTMLInputElement | null>(null);
    React.useImperativeHandle(ref, () => internalRef.current as HTMLInputElement);
    React.useEffect(() => {
      if (internalRef.current) internalRef.current.indeterminate = !!indeterminate;
    }, [indeterminate]);

    const isChecked = checked ?? defaultChecked;
    const isOn = !!isChecked || !!indeterminate;

    const box = (
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[1.5px]",
          "transition-colors",
          isOn
            ? "bg-[var(--ds-grey-medium-07)] text-white"
            : "bg-white border-[0.5px] border-[rgba(0,0,0,0.25)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.1),inset_0_0_2px_rgba(0,0,0,0.1)]",
          disabled && isOn && "bg-[var(--ds-text-disabled)]",
          disabled && !isOn && "border-[var(--ds-text-disabled)]",
        )}
      >
        {indeterminate ? (
          <MinusIcon size={12} strokeWidth={2.5} />
        ) : isChecked ? (
          <CheckIcon size={12} strokeWidth={2.5} />
        ) : null}
      </span>
    );

    if (table) {
      return (
        <label
          className={cn(
            "flex w-full cursor-pointer items-center justify-center border-b border-[var(--ds-grey-light-02)] px-[10px] py-[11px]",
            "hover:bg-[var(--ds-grey-light-01)] hover:border-y hover:border-[var(--ds-grey-light-03)]",
            isOn && "bg-[var(--ds-table-blue-hover)]",
            disabled && "cursor-not-allowed opacity-100",
            className,
          )}
        >
          <input
            ref={internalRef}
            type="checkbox"
            id={id}
            checked={checked}
            defaultChecked={defaultChecked}
            disabled={disabled}
            className="sr-only"
            {...rest}
          />
          {box}
        </label>
      );
    }

    return (
      <label
        className={cn(
          "inline-flex cursor-pointer items-center gap-[6px] text-[14px] leading-[14px]",
          disabled && "cursor-not-allowed",
          className,
        )}
      >
        <input
          ref={internalRef}
          type="checkbox"
          id={id}
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          className="sr-only"
          {...rest}
        />
        {box}
        {label !== undefined && (
          <span
            className={cn(
              "text-[14px] leading-[14px]",
              disabled
                ? "text-[var(--ds-text-disabled)]"
                : "text-[var(--ds-grey-dark-09)]",
            )}
          >
            {label}
          </span>
        )}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
