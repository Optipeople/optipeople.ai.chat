"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// Admin data table — matches the Figma "Tasks Panel, List View" used
// on the machines and accounts lists. Use this for every tabular
// list in the admin area; don't reach for raw <table>/<thead>/<th>
// pairs anymore.
//
// Usage:
//   <DataTable>
//     <DataTableHead>
//       <DataTableHeader>Name</DataTableHeader>
//       <DataTableHeader align="right">Count</DataTableHeader>
//     </DataTableHead>
//     <DataTableBody>
//       <DataTableRow onClick={...}>
//         <DataTableCell className="group-hover:underline">{r.name}</DataTableCell>
//         <DataTableCell align="right" className="tabular-nums">{r.count}</DataTableCell>
//       </DataTableRow>
//     </DataTableBody>
//   </DataTable>

export function DataTable({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <table className={cn("w-full border-collapse text-[14px]", className)}>
      {children}
    </table>
  );
}

export function DataTableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="bg-[#f0f5f5] text-left">{children}</tr>
    </thead>
  );
}

export function DataTableHeader({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "h-[42px] border-b border-[var(--ds-grey-light-03)] px-[10px] pt-[16px] pb-[6px] text-[14px] font-bold leading-[16px] text-[var(--ds-grey-dark-09)]",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function DataTableBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function DataTableRow({
  children,
  onClick,
  href,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  // Navigation target for row click. Prefer this over onClick for rows
  // that open a detail page: it adds keyboard access (Tab + Enter) and
  // restores ctrl/cmd/middle-click open-in-new-tab.
  href?: string;
  className?: string;
}) {
  const router = useRouter();
  const interactive = Boolean(onClick || href);

  const activate = (e?: { ctrlKey?: boolean; metaKey?: boolean }) => {
    if (href) {
      if (e?.ctrlKey || e?.metaKey) {
        window.open(href, "_blank", "noopener");
      } else {
        router.push(href);
      }
    } else {
      onClick?.();
    }
  };

  return (
    <tr
      onClick={interactive ? (e) => activate(e) : undefined}
      onAuxClick={
        href
          ? (e) => {
              if (e.button === 1) window.open(href, "_blank", "noopener");
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                if (e.target !== e.currentTarget) return;
                e.preventDefault();
                activate(e);
              }
            }
          : undefined
      }
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        "group h-[36px] transition-colors",
        interactive &&
          "cursor-pointer hover:bg-[var(--ds-table-blue-hover)] focus-visible:bg-[var(--ds-table-blue-hover)] focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function DataTableCell({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-[var(--ds-grey-light-02)] px-[10px] py-[6px] text-[14px] leading-[21px] text-[var(--ds-grey-dark-09)]",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}
