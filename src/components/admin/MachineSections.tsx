"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionExpander } from "@/components/ui/section-expander";
import { MachineDetail, MachineSettings } from "@/components/admin/MachineDetail";
import { ConversationsList } from "@/components/admin/ConversationsList";
import { EscalationsList } from "@/components/admin/EscalationsList";

type SectionKey = "knowledge" | "settings" | "conversations" | "escalations";

const SECTIONS: readonly SectionKey[] = [
  "knowledge",
  "settings",
  "conversations",
  "escalations",
];

// Machine hub. Replaces the old Knowledge / Settings / Conversations /
// Escalations sub-tabs with four collapsible sections on one page.
// Settings is open by default; the other sections start collapsed.
//
// `?section=...` (set by the legacy sub-route redirects and by deep
// links from other pages) opens that section and scrolls it into view.
export function MachineSections({ machineId }: { machineId: string }) {
  const tn = useTranslations("admin.nav.crumbs");
  const searchParams = useSearchParams();
  const raw = searchParams?.get("section") ?? null;
  const target = (SECTIONS as readonly string[]).includes(raw ?? "")
    ? (raw as SectionKey)
    : null;

  const [knowledgeOpen, setKnowledgeOpen] = useState(target === "knowledge");
  const [settingsOpen, setSettingsOpen] = useState(
    target === null || target === "settings",
  );
  const [conversationsOpen, setConversationsOpen] = useState(
    target === "conversations",
  );
  const [escalationsOpen, setEscalationsOpen] = useState(
    target === "escalations",
  );

  const knowledgeRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const conversationsRef = useRef<HTMLDivElement | null>(null);
  const escalationsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!target) return;
    const el =
      target === "knowledge"
        ? knowledgeRef.current
        : target === "settings"
          ? settingsRef.current
          : target === "conversations"
            ? conversationsRef.current
            : escalationsRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [target]);

  return (
    <div className="flex flex-col gap-3">
      <section
        ref={settingsRef}
        aria-labelledby="section-settings"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={settingsOpen}
          onToggle={() => setSettingsOpen((v) => !v)}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <MachineSettings machineId={machineId} />
            </div>
          }
        >
          <span id="section-settings">{tn("settings")}</span>
        </SectionExpander>
      </section>

      <section
        ref={knowledgeRef}
        aria-labelledby="section-knowledge"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={knowledgeOpen}
          onToggle={() => setKnowledgeOpen((v) => !v)}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <MachineDetail machineId={machineId} />
            </div>
          }
        >
          <span id="section-knowledge">{tn("knowledge")}</span>
        </SectionExpander>
      </section>

      <section
        ref={conversationsRef}
        aria-labelledby="section-conversations"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={conversationsOpen}
          onToggle={() => setConversationsOpen((v) => !v)}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <ConversationsList machineId={machineId} embedded />
            </div>
          }
        >
          <span id="section-conversations">{tn("conversations")}</span>
        </SectionExpander>
      </section>

      <section
        ref={escalationsRef}
        aria-labelledby="section-escalations"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={escalationsOpen}
          onToggle={() => setEscalationsOpen((v) => !v)}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <EscalationsList machineId={machineId} embedded />
            </div>
          }
        >
          <span id="section-escalations">{tn("escalations")}</span>
        </SectionExpander>
      </section>
    </div>
  );
}
