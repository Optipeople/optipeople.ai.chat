"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

export type PaginationProps = {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  /** Sibling pages to show around the current page. Default: 1. */
  siblings?: number;
  className?: string;
};

function PageCell({
  selected,
  onClick,
  children,
  ariaLabel,
  disabled,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-[24px] w-[24px] items-center justify-center rounded-[2px] p-[10px]",
        "text-[14px] leading-[14px] text-[var(--ds-grey-dark-08)]",
        selected
          ? "border border-[var(--ds-grey-light-02)] rounded-[1px] bg-white shadow-[var(--ds-shadow-tag-inset)]"
          : "hover:bg-[var(--ds-grey-light-01)]",
        "disabled:cursor-not-allowed disabled:text-[var(--ds-text-disabled)] disabled:hover:bg-transparent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)]",
      )}
    >
      {children}
    </button>
  );
}

function buildRange(
  current: number,
  total: number,
  siblings: number,
): (number | "...")[] {
  if (total <= 1) return [1];
  const first = 1;
  const last = total;
  const left = Math.max(current - siblings, first + 1);
  const right = Math.min(current + siblings, last - 1);

  const items: (number | "...")[] = [first];
  if (left > first + 1) items.push("...");
  for (let i = left; i <= right; i++) items.push(i);
  if (right < last - 1) items.push("...");
  if (last !== first) items.push(last);
  return items;
}

/** Pagination — matches the Figma "table-pagination" component. */
export function Pagination({
  page,
  pageCount,
  onChange,
  siblings = 1,
  className,
}: PaginationProps) {
  const items = buildRange(page, pageCount, siblings);

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center gap-[6px]", className)}
    >
      <PageCell
        ariaLabel="Previous page"
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
      >
        <ChevronLeftIcon size={14} />
      </PageCell>
      {items.map((item, i) =>
        item === "..." ? (
          <span
            key={`dots-${i}`}
            aria-hidden="true"
            className="inline-flex h-[24px] w-[24px] items-center justify-center text-[14px] text-[var(--ds-grey-dark-08)]"
          >
            …
          </span>
        ) : (
          <PageCell
            key={item}
            ariaLabel={`Page ${item}`}
            selected={item === page}
            onClick={() => onChange(item)}
          >
            {item}
          </PageCell>
        ),
      )}
      <PageCell
        ariaLabel="Next page"
        onClick={() => onChange(Math.min(pageCount, page + 1))}
        disabled={page >= pageCount}
      >
        <ChevronRightIcon size={14} />
      </PageCell>
    </nav>
  );
}
