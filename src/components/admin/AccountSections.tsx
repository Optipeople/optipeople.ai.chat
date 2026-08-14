"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonClasses } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/ui/data-table";
import { SectionExpander } from "@/components/ui/section-expander";
import { AiRulesEditor } from "@/components/admin/AiRulesEditor";
import { McpList } from "@/components/admin/McpList";
import { AccountUsageSection } from "@/components/admin/AccountUsageSection";
import { ConversationsList } from "@/components/admin/ConversationsList";
import { getAdminMachines, type AdminMachine } from "@/admin/adminApi";

type SectionKey = "rules" | "mcp" | "usage" | "machines" | "fleetConversations";

const SECTIONS: readonly SectionKey[] = [
  "rules",
  "mcp",
  "usage",
  "machines",
  "fleetConversations",
];

// Account hub. Replaces the old AI-rules / MCP sub-tabs with
// collapsible sections rendered on one page. All start collapsed.
//
// `?section=rules|mcp|usage|machines` (set by the legacy /rules and
// /mcp redirects and by deep links) opens that section and scrolls it
// into view. Toggling keeps the URL in sync via router.replace so the
// open section survives refresh/share.
export function AccountSections({ accountId }: { accountId: string }) {
  const t = useTranslations("admin.accountSections");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams?.get("section") ?? null;
  const target = (SECTIONS as readonly string[]).includes(raw ?? "")
    ? (raw as SectionKey)
    : null;

  const [open, setOpen] = useState<Record<SectionKey, boolean>>(() => ({
    rules: target === "rules",
    mcp: target === "mcp",
    usage: target === "usage",
    machines: target === "machines",
    fleetConversations: target === "fleetConversations",
  }));

  const rulesRef = useRef<HTMLDivElement | null>(null);
  const mcpRef = useRef<HTMLDivElement | null>(null);
  const usageRef = useRef<HTMLDivElement | null>(null);
  const machinesRef = useRef<HTMLDivElement | null>(null);
  const fleetConversationsRef = useRef<HTMLDivElement | null>(null);
  const refs: Record<
    SectionKey,
    React.RefObject<HTMLDivElement | null>
  > = {
    rules: rulesRef,
    mcp: mcpRef,
    usage: usageRef,
    machines: machinesRef,
    fleetConversations: fleetConversationsRef,
  };

  // Distinguishes ?section= changes issued by our own toggles (no
  // scroll wanted) from external ones (initial load / in-page links).
  const selfUpdate = useRef(false);

  useEffect(() => {
    const self = selfUpdate.current;
    selfUpdate.current = false;
    if (!target || self) return;
    setOpen((o) => (o[target] ? o : { ...o, [target]: true }));
    refs[target].current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    // refs is rebuilt each render but its entries are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  function toggle(key: SectionKey) {
    const willOpen = !open[key];
    setOpen((o) => ({ ...o, [key]: !o[key] }));
    if (willOpen) {
      selfUpdate.current = true;
      router.replace(`${pathname}?section=${key}`, { scroll: false });
    } else if (target === key) {
      selfUpdate.current = true;
      router.replace(pathname, { scroll: false });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section ref={rulesRef} aria-labelledby="section-rules" className="scroll-mt-4">
        <SectionExpander
          expanded={open.rules}
          onToggle={() => toggle("rules")}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <AiRulesEditor accountId={accountId} embedded />
            </div>
          }
        >
          <span id="section-rules">{t("rules")}</span>
        </SectionExpander>
      </section>

      <section ref={mcpRef} aria-labelledby="section-mcp" className="scroll-mt-4">
        <SectionExpander
          expanded={open.mcp}
          onToggle={() => toggle("mcp")}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <McpList accountId={accountId} embedded />
            </div>
          }
        >
          <span id="section-mcp">{t("mcp")}</span>
        </SectionExpander>
      </section>

      <section
        ref={usageRef}
        aria-labelledby="section-usage"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={open.usage}
          onToggle={() => toggle("usage")}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <AccountUsageSection accountId={accountId} />
            </div>
          }
        >
          <span id="section-usage">{t("usage")}</span>
        </SectionExpander>
      </section>

      <section
        ref={machinesRef}
        aria-labelledby="section-machines"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={open.machines}
          onToggle={() => toggle("machines")}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <AccountMachinesSection accountId={accountId} />
            </div>
          }
        >
          <span id="section-machines">{t("machines")}</span>
        </SectionExpander>
      </section>

      {/* Fleet ("all machines") chats have no machine_id, so they never
          appear under any machine's conversation list — this is their
          only audit surface. */}
      <section
        ref={fleetConversationsRef}
        aria-labelledby="section-fleet-conversations"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={open.fleetConversations}
          onToggle={() => toggle("fleetConversations")}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <ConversationsList
                source={{ kind: "fleet", accountId }}
                embedded
              />
            </div>
          }
        >
          <span id="section-fleet-conversations">
            {t("fleetConversations")}
          </span>
        </SectionExpander>
      </section>
    </div>
  );
}

// The account's machines with a jump-off to the full machines list
// (pre-filtered on this account). Read-only — add/edit lives on
// /admin/machines.
function AccountMachinesSection({ accountId }: { accountId: string }) {
  const t = useTranslations("admin.accountSections");
  const tm = useTranslations("admin.machinesList");
  const [machines, setMachines] = useState<AdminMachine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminMachines()
      .then((rows) => {
        if (cancelled) return;
        setMachines(
          rows
            .filter((m) => m.accountId === accountId)
            .sort((a, b) =>
              (a.displayName ?? "").localeCompare(b.displayName ?? ""),
            ),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("machinesLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  if (error) {
    return (
      <div className="rounded-[4px] border border-[var(--ds-tag-red-dark)] bg-[var(--ds-tag-red-light)] p-4 text-[14px] text-[var(--ds-red-dark)]">
        {error}
      </div>
    );
  }

  if (machines === null) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {machines.length === 0 ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-center text-[14px] text-[var(--color-muted-foreground)]">
          {t("machinesEmpty")}
        </div>
      ) : (
        <DataTable>
          <DataTableHead>
            <DataTableHeader>{tm("colName")}</DataTableHeader>
            <DataTableHeader align="right">{tm("colDocuments")}</DataTableHeader>
          </DataTableHead>
          <DataTableBody>
            {machines.map((m) => (
              <DataTableRow
                key={m.machineId}
                href={`/admin/machines/${m.machineId}`}
              >
                <DataTableCell className="group-hover:underline">
                  {m.displayName ?? tm("noName")}
                </DataTableCell>
                <DataTableCell align="right" className="tabular-nums">
                  {m.documentCount}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
      <Link
        href={`/admin/machines?account=${encodeURIComponent(accountId)}`}
        className={buttonClasses({
          variant: "secondary",
          size: "compact",
          className: "self-start",
        })}
      >
        {t("machinesOpenList")}
      </Link>
    </div>
  );
}
