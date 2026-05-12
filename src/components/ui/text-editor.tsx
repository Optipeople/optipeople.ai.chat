"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Field } from "./field";
import { BoldIcon, LinkIcon, SpellCheckIcon } from "./icons";

export type TextEditorToolbar = "minimal" | "spellChecker" | "code";

export type TextEditorProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "rows"
> & {
  label?: React.ReactNode;
  toolbar?: TextEditorToolbar;
  rows?: number;
  toolbarExtras?: React.ReactNode;
};

function ToolbarButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-[25px] items-center justify-center rounded-[2px] px-[6px]",
        "text-[var(--ds-grey-dark-09)] hover:bg-[var(--ds-grey-light-01)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
        rest.className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * TextEditor — matches the Figma "text-editor" component.
 *
 * The three toolbar variants share the same shell; the "code" variant
 * additionally swaps in a dark-teal surface and a monospaced font.
 */
export const TextEditor = React.forwardRef<HTMLTextAreaElement, TextEditorProps>(
  (
    {
      label = "Label",
      toolbar = "minimal",
      rows = 8,
      toolbarExtras,
      className,
      id,
      ...textareaProps
    },
    ref,
  ) => {
    const reactId = React.useId();
    const fieldId = id ?? reactId;
    const isCode = toolbar === "code";

    return (
      <Field label={label} htmlFor={fieldId}>
        <div
          className={cn(
            "flex w-full min-h-[220px] flex-col gap-[12px] overflow-hidden rounded-[2px] bg-white",
            "shadow-[var(--ds-shadow-input)]",
            isCode ? "p-[12px]" : "px-[7px] pb-[12px] pt-[5px]",
            className,
          )}
        >
          {!isCode && (
            <div className="flex items-center gap-[8px] border-b border-[var(--ds-grey-light-03)] p-[6px]">
              <ToolbarButton aria-label="Bold">
                <BoldIcon size={20} />
              </ToolbarButton>
              <ToolbarButton aria-label="Insert link" className="flex-1 justify-start">
                <LinkIcon size={16} />
              </ToolbarButton>
              {toolbar === "spellChecker" && (
                <ToolbarButton aria-label="Spell-check">
                  <SpellCheckIcon size={22} />
                </ToolbarButton>
              )}
              {toolbarExtras}
            </div>
          )}
          <textarea
            ref={ref}
            id={fieldId}
            rows={rows}
            className={cn(
              "w-full flex-1 resize-none rounded-[2px] p-[12px] outline-none",
              "text-[14px] leading-[21px]",
              isCode
                ? "bg-[var(--ds-grey-medium-07)] text-[var(--ds-grey-light-01)] font-['IBM_Plex_Mono',ui-monospace,monospace] p-[18px]"
                : "bg-white text-[var(--ds-grey-dark-09)] font-['Hanken_Grotesk',sans-serif] font-normal",
            )}
            placeholder={isCode ? "" : "Write here."}
            {...textareaProps}
          />
        </div>
      </Field>
    );
  },
);
TextEditor.displayName = "TextEditor";
