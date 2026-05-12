import * as React from "react";
import { cn } from "@/lib/utils";

export type ValidationState = "none" | "required" | "valid" | "error";

export type FieldFrameProps = React.HTMLAttributes<HTMLDivElement> & {
  validation?: ValidationState;
  disabled?: boolean;
  focused?: boolean;
  /** When true, removes the outer shadow (used by the text-editor variant). */
  flat?: boolean;
};

/**
 * Shared visual frame for input-like fields. Provides the standard background,
 * radius, shadow, and validation-state right border that the design system
 * uses across TextField, Textarea, SearchField and TextEditor.
 */
export const FieldFrame = React.forwardRef<HTMLDivElement, FieldFrameProps>(
  (
    { className, validation = "none", disabled, focused, flat, ...rest },
    ref,
  ) => (
    <div
      ref={ref}
      data-validation={validation}
      data-disabled={disabled ? "" : undefined}
      data-focused={focused ? "" : undefined}
      className={cn(
        "relative rounded-[4px] bg-white",
        !flat && "shadow-[var(--ds-shadow-input)]",
        disabled && "bg-[var(--ds-bg-disabled)]",
        validation === "required" &&
          "border-r-[6px] border-[var(--ds-orange)] rounded-r-none",
        validation === "valid" &&
          "border-r-[6px] border-[var(--ds-green)] rounded-r-none",
        validation === "error" &&
          "border-r-[6px] border-[var(--ds-red)] rounded-r-none bg-[var(--ds-red-validation-bg)]",
        focused &&
          "shadow-[inset_0_0_0_2px_var(--ds-green-80),var(--ds-shadow-input)]",
        className,
      )}
      {...rest}
    />
  ),
);
FieldFrame.displayName = "FieldFrame";

export type FieldProps = {
  label?: React.ReactNode;
  helpText?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
};

/** Vertical stack of [label][control][help-text] using DS typography. */
export function Field({
  label,
  helpText,
  htmlFor,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("flex w-full flex-col", className)}>
      {label !== undefined && label !== null && label !== false && (
        <label
          htmlFor={htmlFor}
          className="text-[14px] leading-[21px] text-[var(--ds-grey-medium-04)]"
        >
          {label}
        </label>
      )}
      {children}
      {helpText !== undefined && helpText !== null && helpText !== false && (
        <p className="mt-[2px] text-right text-[12px] leading-[21px] text-[var(--ds-grey-medium-05)]">
          {helpText}
        </p>
      )}
    </div>
  );
}
