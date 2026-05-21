"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Field, FieldFrame, type ValidationState } from "./field";

export type SelectOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export type SelectProps = {
  label?: React.ReactNode;
  helpText?: React.ReactNode;
  size?: "small" | "medium";
  validation?: ValidationState;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  placeholder?: React.ReactNode;
  children?: React.ReactNode;
  items?: ReadonlyArray<SelectOption>;
  "aria-label"?: string;
};

const SIZES = {
  small: {
    text: "text-[14px] leading-[14px]",
    height: "h-[30px]",
    pillH: "h-[16px]",
    pillW: "w-[15px]",
    iconSize: 10,
  },
  medium: {
    text: "text-[16px] leading-[20px]",
    height: "h-[40px]",
    pillH: "h-[20px]",
    pillW: "w-[20px]",
    iconSize: 12,
  },
} as const;

function ChevronGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6l5 5 5-5" />
    </svg>
  );
}

function CheckmarkGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 12 10"
      width={size}
      height={(size * 10) / 12}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 5.5L4.2 8.5 11 1.5" />
    </svg>
  );
}

function extractOptionsFromChildren(
  children: React.ReactNode,
): SelectOption[] {
  const out: SelectOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      const props = child.props as { children?: React.ReactNode };
      out.push(...extractOptionsFromChildren(props.children));
      return;
    }
    if (child.type === "option") {
      const props =
        child.props as React.OptionHTMLAttributes<HTMLOptionElement> & {
          children?: React.ReactNode;
        };
      out.push({
        value: String(props.value ?? ""),
        label: props.children ?? "",
        disabled: props.disabled,
      });
    }
  });
  return out;
}

/**
 * Select — matches the Figma "_pulldown-button" + "_menu" components.
 *
 * Custom listbox popover (not a native <select>) so the open menu can
 * match the Figma styling: soft drop-shadow, blue-secondary hover, and
 * a checkmark on the active value. Accessibility is handled manually:
 * arrow keys to navigate, Enter/Space to select, Esc/Tab/outside-click
 * to close, type-to-select.
 */
export function Select({
  label,
  helpText,
  size = "small",
  validation = "none",
  disabled,
  className,
  id,
  name,
  value,
  onValueChange,
  placeholder,
  children,
  items,
  "aria-label": ariaLabel,
}: SelectProps) {
  const reactId = React.useId();
  const triggerId = id ?? reactId;
  const listboxId = `${triggerId}-listbox`;
  const sizing = SIZES[size];

  const options = React.useMemo(
    () => items ?? extractOptionsFromChildren(children),
    [items, children],
  );
  const selected = options.find((o) => o.value === value);

  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState<number>(-1);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const [menuRect, setMenuRect] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const typeBufferRef = React.useRef<{ buf: string; t: number }>({
    buf: "",
    t: 0,
  });

  const openMenu = React.useCallback(() => {
    if (disabled) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      setMenuRect({
        top: r.bottom + window.scrollY + 6,
        left: r.left + window.scrollX,
        width: r.width,
      });
    }
    const i = options.findIndex((o) => o.value === value);
    setActiveIndex(i >= 0 ? i : firstEnabledIndex(options));
    setOpen(true);
  }, [disabled, options, value]);

  const closeMenu = React.useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setActiveIndex(-1);
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  const selectAt = React.useCallback(
    (i: number) => {
      const opt = options[i];
      if (!opt || opt.disabled) return;
      onValueChange(opt.value);
      closeMenu(true);
    },
    [options, onValueChange, closeMenu],
  );

  React.useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (listRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const onResize = () => closeMenu(false);
    document.addEventListener("pointerdown", onDocPointer);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, closeMenu]);

  // Keep the active item scrolled into view as the user navigates.
  React.useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Enter" ||
      e.key === " "
    ) {
      e.preventDefault();
      openMenu();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      closeMenu(true);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) selectAt(activeIndex);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => nextEnabledIndex(options, i, 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => nextEnabledIndex(options, i, -1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(firstEnabledIndex(options));
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(lastEnabledIndex(options));
      return;
    }
    // Type-to-select: match the leading character of an option's text.
    if (e.key.length === 1) {
      const now = Date.now();
      const buf =
        now - typeBufferRef.current.t < 600 ? typeBufferRef.current.buf : "";
      const next = (buf + e.key).toLowerCase();
      typeBufferRef.current = { buf: next, t: now };
      const match = options.findIndex(
        (o) =>
          !o.disabled && optionText(o.label).toLowerCase().startsWith(next),
      );
      if (match >= 0) setActiveIndex(match);
    }
  };

  return (
    <Field label={label} helpText={helpText} htmlFor={triggerId}>
      <FieldFrame
        validation={validation}
        disabled={disabled}
        focused={false}
        className={cn(
          "relative rounded-[2px]",
          sizing.height,
          className,
        )}
      >
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => (open ? closeMenu(true) : openMenu())}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "absolute inset-0 flex w-full items-center",
            "appearance-none bg-transparent outline-none",
            "cursor-pointer disabled:cursor-not-allowed",
            "font-['Hanken_Grotesk',sans-serif] font-normal text-left",
            sizing.text,
            "text-[var(--ds-grey-dark-09)]",
            "disabled:text-[var(--ds-grey-medium-05)]",
            "pl-[8px] pr-[30px]",
            "focus-visible:rounded-[2px] focus-visible:shadow-[inset_0_0_0_2px_var(--ds-green-80)]",
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? (
              selected.label
            ) : (
              <span className="text-[var(--ds-grey-light-03)]">
                {placeholder ?? ""}
              </span>
            )}
          </span>
        </button>
        <span
          aria-hidden
          data-disabled={disabled ? "" : undefined}
          className={cn(
            "pointer-events-none absolute right-[7px] top-1/2 -translate-y-1/2",
            "flex items-center justify-center rounded-[2px] text-white",
            "bg-[#134343]",
            "shadow-[0px_1px_2.5px_rgba(0,122,255,0.24),0px_0px_0px_0.5px_rgba(0,122,255,0.12)]",
            "data-[disabled]:bg-[var(--ds-grey-light-03)] data-[disabled]:shadow-none",
            sizing.pillH,
            sizing.pillW,
          )}
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(255,255,255,0.17) 0%, rgba(255,255,255,0) 100%)",
          }}
        >
          <ChevronGlyph size={sizing.iconSize} />
        </span>
        {name ? <input type="hidden" name={name} value={value} /> : null}
      </FieldFrame>
      {open && menuRect ? <SelectMenu
        listRef={listRef}
        listboxId={listboxId}
        rect={menuRect}
        options={options}
        value={value}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        onSelect={selectAt}
        onKeyDown={onListKeyDown}
      /> : null}
    </Field>
  );
}

function SelectMenu({
  listRef,
  listboxId,
  rect,
  options,
  value,
  activeIndex,
  setActiveIndex,
  onSelect,
  onKeyDown,
}: {
  listRef: React.RefObject<HTMLUListElement | null>;
  listboxId: string;
  rect: { top: number; left: number; width: number };
  options: ReadonlyArray<SelectOption>;
  value: string;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  onSelect: (i: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  // Focus the listbox once mounted so keyboard nav works immediately.
  React.useEffect(() => {
    listRef.current?.focus();
    // listRef is a stable ref — depending on it is just to satisfy
    // exhaustive-deps without re-running on every render.
  }, [listRef]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <ul
      ref={listRef}
      id={listboxId}
      role="listbox"
      tabIndex={-1}
      aria-activedescendant={
        activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
      }
      onKeyDown={onKeyDown}
      style={{
        position: "absolute",
        top: rect.top,
        left: rect.left,
        minWidth: rect.width,
      }}
      className={cn(
        "z-50 flex flex-col gap-[6px] rounded-[2px] bg-white outline-none",
        "px-[8px] py-[12px]",
        "shadow-[0px_0px_0.5px_rgba(0,0,0,0.4),0px_0px_0.75px_rgba(0,0,0,0.3),0px_7px_11px_rgba(0,0,0,0.25)]",
      )}
    >
      {options.map((opt, i) => {
        const isSelected = opt.value === value;
        const isActive = i === activeIndex;
        return (
          <li
            key={`${opt.value}-${i}`}
            id={`${listboxId}-opt-${i}`}
            data-index={i}
            role="option"
            aria-selected={isSelected}
            aria-disabled={opt.disabled || undefined}
            onPointerEnter={() => !opt.disabled && setActiveIndex(i)}
            onPointerDown={(e) => {
              // PointerDown so the doc-level pointerdown handler doesn't
              // close the menu before our click registers.
              e.preventDefault();
              if (!opt.disabled) onSelect(i);
            }}
            className={cn(
              "flex items-center rounded-[2px]",
              "font-['Hanken_Grotesk',sans-serif] font-normal text-[14px] leading-[14px]",
              "text-[var(--ds-grey-dark-09)]",
              "cursor-pointer select-none",
              "aria-disabled:cursor-not-allowed aria-disabled:text-[var(--ds-text-disabled)]",
              isSelected
                ? "gap-[5px] pl-[5px] pr-[12px] py-[3px] h-[20px]"
                : "pl-[22px] pr-[12px] py-[3px]",
              isActive && !opt.disabled
                ? "bg-[var(--ds-blue-secondary)]"
                : null,
            )}
          >
            {isSelected ? (
              <span className="flex h-[10px] w-[12px] shrink-0 items-center justify-center text-[var(--ds-grey-dark-09)]">
                <CheckmarkGlyph size={12} />
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{opt.label}</span>
          </li>
        );
      })}
    </ul>,
    document.body,
  );
}

function firstEnabledIndex(opts: ReadonlyArray<SelectOption>): number {
  return opts.findIndex((o) => !o.disabled);
}

function lastEnabledIndex(opts: ReadonlyArray<SelectOption>): number {
  for (let i = opts.length - 1; i >= 0; i -= 1) {
    if (!opts[i].disabled) return i;
  }
  return -1;
}

function nextEnabledIndex(
  opts: ReadonlyArray<SelectOption>,
  from: number,
  step: 1 | -1,
): number {
  if (opts.length === 0) return -1;
  let i = from;
  for (let n = 0; n < opts.length; n += 1) {
    i = (i + step + opts.length) % opts.length;
    if (!opts[i].disabled) return i;
  }
  return from;
}

function optionText(label: React.ReactNode): string {
  if (typeof label === "string" || typeof label === "number") {
    return String(label);
  }
  if (Array.isArray(label)) {
    return label.map(optionText).join("");
  }
  if (React.isValidElement(label)) {
    const props = label.props as { children?: React.ReactNode };
    return optionText(props.children);
  }
  return "";
}
