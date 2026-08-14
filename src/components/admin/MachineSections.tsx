"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
// Toggling keeps the URL in sync via router.replace so the open section
// survives refresh/share.
export function MachineSections({ machineId }: { machineId: string }) {
  const tn = useTranslations("admin.nav.crumbs");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams?.get("section") ?? null;
  const target = (SECTIONS as readonly string[]).includes(raw ?? "")
    ? (raw as SectionKey)
    : null;

  const [open, setOpen] = useState<Record<SectionKey, boolean>>(() => ({
    knowledge: target === "knowledge",
    settings: target === null || target === "settings",
    conversations: target === "conversations",
    escalations: target === "escalations",
  }));

  const knowledgeRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const conversationsRef = useRef<HTMLDivElement | null>(null);
  const escalationsRef = useRef<HTMLDivElement | null>(null);
  const refs: Record<
    SectionKey,
    React.RefObject<HTMLDivElement | null>
  > = {
    knowledge: knowledgeRef,
    settings: settingsRef,
    conversations: conversationsRef,
    escalations: escalationsRef,
  };

  // Distinguishes ?section= changes issued by our own toggles (no
  // scroll wanted) from external ones (initial load / in-page links).
  const selfUpdate = useRef(false);

  useEffect(() => {
    const self = selfUpdate.current;
    selfUpdate.current = false;
    if (!target || self) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <section
        ref={settingsRef}
        aria-labelledby="section-settings"
        className="scroll-mt-4"
      >
        <SectionExpander
          expanded={open.settings}
          onToggle={() => toggle("settings")}
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
          expanded={open.knowledge}
          onToggle={() => toggle("knowledge")}
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
          expanded={open.conversations}
          onToggle={() => toggle("conversations")}
          keepMounted
          panel={
            <div className="pt-5 sm:pt-6">
              <ConversationsList source={{ kind: "machine", machineId }} embedded />
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
          expanded={open.escalations}
          onToggle={() => toggle("escalations")}
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
