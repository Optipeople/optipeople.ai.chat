"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SectionExpander } from "@/components/ui/section-expander";
import { AiRulesEditor } from "@/components/admin/AiRulesEditor";
import { McpList } from "@/components/admin/McpList";
import { AccountUsageSection } from "@/components/admin/AccountUsageSection";

type SectionKey = "rules" | "mcp" | "usage";

// Account hub. Replaces the old AI-rules / MCP sub-tabs with
// collapsible sections rendered on one page. All start collapsed.
//
// `?section=rules|mcp|usage` (set by the legacy /rules and /mcp
// redirects) opens that section and scrolls it into view.
export function AccountSections({ accountId }: { accountId: string }) {
  const searchParams = useSearchParams();
  const target = (searchParams?.get("section") ?? null) as SectionKey | null;

  const [rulesOpen, setRulesOpen] = useState(target === "rules");
  const [mcpOpen, setMcpOpen] = useState(target === "mcp");
  const [usageOpen, setUsageOpen] = useState(target === "usage");

  const rulesRef = useRef<HTMLDivElement | null>(null);
  const mcpRef = useRef<HTMLDivElement | null>(null);
  const usageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (target !== "rules" && target !== "mcp" && target !== "usage") return;
    const el =
      target === "rules"
        ? rulesRef.current
        : target === "mcp"
          ? mcpRef.current
          : usageRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [target]);

  return (
    <div className="flex flex-col gap-3">
      <section ref={rulesRef} aria-labelledby="section-rules" className="scroll-mt-4">
        <SectionExpander
          expanded={rulesOpen}
          onToggle={() => setRulesOpen((v) => !v)}
          panel={
            <div className="pt-5 sm:pt-6">
              <AiRulesEditor accountId={accountId} embedded />
            </div>
          }
        >
          <span id="section-rules">AI rules</span>
        </SectionExpander>
      </section>

      <section ref={mcpRef} aria-labelledby="section-mcp" className="scroll-mt-4">
        <SectionExpander
          expanded={mcpOpen}
          onToggle={() => setMcpOpen((v) => !v)}
          panel={
            <div className="pt-5 sm:pt-6">
              <McpList accountId={accountId} embedded />
            </div>
          }
        >
          <span id="section-mcp">MCP integration</span>
        </SectionExpander>
      </section>

      <section
        ref={usageRef}
        aria-labelledby="section-usage"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={usageOpen}
          onToggle={() => setUsageOpen((v) => !v)}
          panel={
            <div className="pt-5 sm:pt-6">
              <AccountUsageSection accountId={accountId} />
            </div>
          }
        >
          <span id="section-usage">Token usage</span>
        </SectionExpander>
      </section>
    </div>
  );
}
