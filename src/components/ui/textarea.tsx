"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Field, FieldFrame, type ValidationState } from "./field";

export type TextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "rows" | "size"
> & {
  label?: React.ReactNode;
  helpText?: React.ReactNode;
  validation?: ValidationState;
  rows?: number;
  /** Allow the field to grow with its content (auto-resize). */
  autoGrow?: boolean;
  /** Font / spacing scale. "small" = 14/21px, "medium" = 19/26px. */
  size?: "small" | "medium";
};

const SIZE_TEXT = {
  small: "text-[14px] leading-[21px]",
  medium: "text-[19px] leading-[26px]",
} as const;

/**
 * Textarea — matches the Figma "text-area" component.
 *
 * The shell uses the shared FieldFrame so validation styling stays in sync
 * with TextField. Content uses 14px / 21px line-height per the design.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      helpText,
      validation = "none",
      disabled,
      className,
      rows = 5,
      autoGrow,
      size = "small",
      id,
      onInput,
      ...textareaProps
    },
    ref,
  ) => {
    const reactId = React.useId();
    const fieldId = id ?? reactId;
    const [focused, setFocused] = React.useState(false);
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    React.useImperativeHandle(
      ref,
      () => innerRef.current as HTMLTextAreaElement,
    );

    const handleInput: React.FormEventHandler<HTMLTextAreaElement> = (e) => {
      if (autoGrow && innerRef.current) {
        innerRef.current.style.height = "auto";
        innerRef.current.style.height = `${innerRef.current.scrollHeight}px`;
      }
      // The wider FormEvent is compatible with the InputEvent expected by onInput.
      (onInput as React.FormEventHandler<HTMLTextAreaElement> | undefined)?.(e);
    };

    return (
      <Field label={label} helpText={helpText} htmlFor={fieldId}>
        <FieldFrame
          validation={validation}
          disabled={disabled}
          focused={focused && validation === "none"}
          className={cn("flex p-[16px]", className)}
        >
          <textarea
            ref={innerRef}
            id={fieldId}
            rows={rows}
            disabled={disabled}
            onFocus={(e) => {
              setFocused(true);
              textareaProps.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              textareaProps.onBlur?.(e);
            }}
            onInput={handleInput}
            className={cn(
              "w-full resize-none bg-transparent outline-none",
              "font-['Hanken_Grotesk',sans-serif] font-normal",
              SIZE_TEXT[size],
              "text-[var(--ds-grey-dark-09)]",
              "placeholder:text-[var(--ds-grey-light-03)]",
              "disabled:cursor-not-allowed disabled:text-[var(--ds-grey-medium-05)]",
              autoGrow && "overflow-hidden",
            )}
            {...textareaProps}
          />
        </FieldFrame>
      </Field>
    );
  },
);
Textarea.displayName = "Textarea";
