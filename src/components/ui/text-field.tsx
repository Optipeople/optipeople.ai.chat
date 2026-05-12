"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Field, FieldFrame, type ValidationState } from "./field";
import {
  CircleCheckIcon,
  CircleXIcon,
  TriangleExclamationIcon,
} from "./icons";

export type TextFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size"
> & {
  label?: React.ReactNode;
  helpText?: React.ReactNode;
  size?: "small" | "medium";
  validation?: ValidationState;
  /** Optional element rendered inside the frame, before the input. */
  leftAdornment?: React.ReactNode;
  /** Optional element rendered inside the frame, after the input. */
  rightAdornment?: React.ReactNode;
};

const SIZES = {
  small: {
    text: "text-[14px] leading-[21px]",
    pad: "px-[7px] py-[4.5px]",
    height: "h-[30px]",
  },
  medium: {
    text: "text-[21px] leading-[28px]",
    pad: "p-[7px]",
    height: "h-[44px]",
  },
} as const;

/**
 * TextField — matches the Figma "text-field" component.
 *
 * The validation prop drives both the right-edge color bar and the
 * status icon shown on the right of the input.
 */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      label,
      helpText,
      size = "small",
      validation = "none",
      disabled,
      leftAdornment,
      rightAdornment,
      className,
      id,
      ...inputProps
    },
    ref,
  ) => {
    const reactId = React.useId();
    const inputId = id ?? reactId;
    const [focused, setFocused] = React.useState(false);
    const sizing = SIZES[size];

    const validationIcon =
      validation === "valid" ? (
        <CircleCheckIcon
          size={16}
          className="shrink-0 text-[var(--ds-green)]"
        />
      ) : validation === "error" ? (
        <TriangleExclamationIcon
          size={16}
          className="shrink-0 text-[var(--ds-red)]"
        />
      ) : null;

    return (
      <Field label={label} helpText={helpText} htmlFor={inputId}>
        <FieldFrame
          validation={validation}
          disabled={disabled}
          focused={focused && validation === "none"}
          className={cn(
            "flex items-center gap-[8px] overflow-hidden",
            sizing.pad,
            sizing.height,
            className,
          )}
        >
          {leftAdornment}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            onFocus={(e) => {
              setFocused(true);
              inputProps.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              inputProps.onBlur?.(e);
            }}
            className={cn(
              "min-w-0 flex-1 bg-transparent outline-none",
              "font-['Hanken_Grotesk',sans-serif] font-normal",
              sizing.text,
              "text-[var(--ds-grey-dark-09)]",
              "placeholder:text-[var(--ds-grey-light-03)]",
              "disabled:cursor-not-allowed disabled:text-[var(--ds-grey-medium-05)]",
            )}
            {...inputProps}
          />
          {validationIcon}
          {rightAdornment}
        </FieldFrame>
      </Field>
    );
  },
);
TextField.displayName = "TextField";

/** Inline icon affordance used by some text-field examples (e.g. clear-x). */
export function TextFieldClearButton({
  onClick,
  label = "Clear",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="text-[var(--ds-grey-medium-05)] hover:text-[var(--ds-grey-dark-09)]"
    >
      <CircleXIcon size={16} />
    </button>
  );
}
