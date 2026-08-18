"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ChevronRight,
  FileText,
  Folder,
  Image as ImageIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { fetchWithAuth } from "@/auth/authApi";
import { getQrToken } from "@/auth/qrStorage";
import { isAdmin, useAuth } from "@/auth/AuthContext";
import { ConversationList } from "@/components/ConversationList";
import { useFileViewer } from "@/components/FileViewer";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { cn } from "@/lib/utils";
import type {
  OperatorDocument,
  OperatorDocumentsResponse,
} from "@/app/api/machines/[id]/documents/route";
import type { FleetDocumentsResponse } from "@/app/api/accounts/[id]/documents/route";

// Inline left sidebar next to the chat column (not an overlay), with
// two tabs:
//
//   Documents     — operator-visible manuals for the current machine,
//                   or every machine on the account in fleet scope.
//                   Rows open the original PDF / image via the
//                   FileViewer, which respects both bearer and QR auth
//                   modes (fleet is bearer-only).
//   Conversations — the operator's own chat history for the same
//                   target. Selecting one reopens it in the chat.
//
// Defaults to open on desktop and collapses to a thin rail; on mobile
// it's a rail plus a modal overlay.
const MOBILE_MQ = "(max-width: 639px)";

// Same source-union shape as ConversationsList/ConversationDetail.
export type KnowledgeDrawerSource =
  | { kind: "machine"; machineId: string }
  | { kind: "fleet"; accountId: string };

type DrawerTab = "documents" | "conversations";

export function KnowledgeDrawer({
  source,
  activeConversationId = null,
  loadingConversationId = null,
  onSelectConversation,
}: {
  source: KnowledgeDrawerSource;
  // Conversation currently open in the chat — highlighted in the list.
  activeConversationId?: string | null;
  // Conversation whose transcript the chat is fetching right now.
  loadingConversationId?: string | null;
  // Omitted when the host has no way to reopen a conversation, in which
  // case the Conversations tab is not offered at all.
  onSelectConversation?: (id: string) => void;
}) {
  const t = useTranslations("knowledgeDrawer");
  const [tab, setTab] = useState<DrawerTab>("documents");
  const showConversations = !!onSelectConversation;
  const { user } = useAuth();
  // Admins (super or account-scoped) get a link to the admin upload
  // section. Operators see the same drawer minus the affordance —
  // /api/admin/ingest is server-gated, so this is a UI hint only.
  // Fleet scope has no single machine to upload to, so no affordance.
  const canUpload = isAdmin(user) && source.kind === "machine";
  const adminUploadHref =
    source.kind === "machine"
      ? `/admin/machines/${encodeURIComponent(source.machineId)}#upload`
      : "";
  // Track viewport size so we can render an overlay drawer on small
  // screens and an inline sidebar on >= sm. Lazy initializers read
  // matchMedia on first client render so mobile users don't see the
  // drawer expand and then snap closed.
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MOBILE_MQ).matches;
  });
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return !window.matchMedia(MOBILE_MQ).matches;
  });
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<OperatorDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Mobile overlay is a modal dialog: trap focus while open, close on
  // Escape.
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(mobilePanelRef, isMobile && open);
  useEffect(() => {
    if (!isMobile || !open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isMobile, open]);

  // Primitive key so load()'s identity doesn't churn when the parent
  // rebuilds the source object every render (an object dep would make
  // the open-triggered fetch effect loop).
  const sourceKind = source.kind;
  const sourceId =
    source.kind === "machine" ? source.machineId : source.accountId;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (sourceKind === "fleet") {
        const res = await fetchWithAuth(
          `/api/accounts/${encodeURIComponent(sourceId)}/documents`,
        );
        if (!res.ok) {
          throw new Error(`Server error ${res.status}`);
        }
        const body = (await res.json()) as FleetDocumentsResponse;
        // Reuse the folder-tree UI with the machine as the group: each
        // doc's folderPath is projected to its machine name. Per-machine
        // folder structure is deliberately collapsed in fleet view —
        // one grouping level keeps the drawer scannable.
        setDocs(
          body.documents.map((d) => ({
            ...d,
            folderPath: d.machineName ?? d.machineId,
          })),
        );
        return;
      }
      const qrToken = getQrToken();
      const url = qrToken
        ? `/api/machines/${encodeURIComponent(sourceId)}/documents?qrToken=${encodeURIComponent(qrToken)}`
        : `/api/machines/${encodeURIComponent(sourceId)}/documents`;
      const res = await fetchWithAuth(url);
      if (!res.ok) {
        throw new Error(`Server error ${res.status}`);
      }
      const body = (await res.json()) as OperatorDocumentsResponse;
      setDocs(body.documents);
    } catch (err) {
      console.error("Knowledge drawer load failed", err);
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [sourceKind, sourceId, t]);

  // Fetch when first opened, and refetch on each reopen so newly
  // promoted documents show up without a page reload. The synchronous
  // setState inside load() is the loading flag — intentional. The
  // Conversations tab fetches its own list on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && tab === "documents") void load();
  }, [open, tab, load]);

  // Underline tab strip. Sits on the header's hairline (-mb-px) so the
  // active tab's rule reads as a continuation of it. Sized down from
  // the old h2 so both labels plus the collapse button fit the 288px
  // panel in every locale.
  const tabStrip = (
    <div
      role="tablist"
      aria-label={t("drawerAria")}
      className="flex min-w-0 items-end gap-3"
    >
      {(showConversations
        ? (["documents", "conversations"] as const)
        : (["documents"] as const)
      ).map((id) => {
        const selected = tab === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`kb-tab-${id}`}
            aria-selected={selected}
            aria-controls={`kb-panel-${id}`}
            tabIndex={open ? 0 : -1}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px shrink-0 border-b-2 pb-2 text-[15px] font-semibold tracking-tight",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              selected
                ? "border-white text-white"
                : "border-transparent text-white/60 hover:text-white/90",
            )}
          >
            {t(id === "documents" ? "tabs.documents" : "tabs.conversations")}
          </button>
        );
      })}
    </div>
  );

  const activeTabLabel = t(
    tab === "documents" ? "tabs.documents" : "tabs.conversations",
  );

  const uploadButton = canUpload ? (
    <Link
      href={adminUploadHref}
      className={buttonClasses({ variant: "secondary", className: "w-full gap-2" })}
    >
      <Upload className="h-4 w-4" />
      <span>{t("adminUpload")}</span>
    </Link>
  ) : null;

  const docList = (
    <>
      {loading && (
        <div className="flex h-full items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      )}
      {!loading && error && (
        <div className="mx-3 rounded-[4px] border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-[13px] font-medium text-red-700 underline hover:text-red-800"
          >
            {t("retry")}
          </button>
        </div>
      )}
      {!loading && !error && docs && docs.length === 0 && (
        <div className="px-4 py-8 text-center sm:px-6">
          {canUpload ? (
            <>
              <p className="text-[15px] font-medium text-white">
                {t("adminEmptyTitle")}
              </p>
              <p className="mt-2 text-[14px] leading-[1.5] text-white/70">
                {t("adminEmptyBody")}
              </p>
              <Link
                href={adminUploadHref}
                className={buttonClasses({ variant: "secondary", className: "mt-5 gap-2" })}
              >
                <Upload className="h-4 w-4" />
                <span>{t("adminUpload")}</span>
              </Link>
            </>
          ) : (
            <p className="text-[15px] text-white/70">{t("empty")}</p>
          )}
        </div>
      )}
      {!loading && !error && docs && docs.length > 0 && (
        <DocumentTree docs={docs} />
      )}
    </>
  );

  // Everything under the header, shared by the desktop panel and the
  // mobile overlay (only one of the two is mounted at a time). The tab
  // panels are mounted only while the drawer is open so a collapsed
  // rail never fetches.
  const panelBody = (
    <>
      <p className="px-4 pt-3 text-[14px] leading-[1.5] text-white/70 sm:px-6">
        {tab === "documents"
          ? t(sourceKind === "fleet" ? "fleetDescription" : "description")
          : t(
              sourceKind === "fleet"
                ? "conversationsFleetDescription"
                : "conversationsDescription",
            )}
      </p>
      {tab === "documents" && canUpload && docs && docs.length > 0 && (
        <div className="px-4 pt-4 sm:px-6">{uploadButton}</div>
      )}
      <div
        role="tabpanel"
        id={`kb-panel-${tab}`}
        aria-labelledby={`kb-tab-${tab}`}
        className="flex-1 overflow-y-auto pb-3 pt-6"
      >
        {tab === "documents"
          ? docList
          : open && (
              <ConversationList
                source={source}
                activeConversationId={activeConversationId}
                loadingConversationId={loadingConversationId}
                onSelect={(id) => {
                  onSelectConversation?.(id);
                  // The overlay covers the chat on mobile — get out of
                  // the way so the reopened thread is actually visible.
                  if (isMobile) setOpen(false);
                }}
              />
            )}
      </div>
    </>
  );

  // Desktop (>= sm): single inline aside that animates its width
  // between the 40px rail and the 288/320px panel. Two layered layouts
  // cross-fade — the rail open button (top-left) when collapsed, and
  // the full panel with the close button on the right when open.
  if (!isMobile) {
    return (
      <aside
        role="complementary"
        aria-label={t("drawerAria")}
        className={cn(
          "relative h-full shrink-0 overflow-hidden",
          "bg-[var(--color-brand)]",
          "transition-[width] duration-[220ms] ease-out",
          open ? "w-72 sm:w-80" : "w-[35px]",
        )}
      >
        {/* Rail layout — visible when collapsed. */}
        <div
          className={cn(
            "absolute left-0 top-0 flex w-[35px] flex-col items-center pt-5 transition-opacity",
            open
              ? "pointer-events-none opacity-0 duration-100"
              : "opacity-100 duration-200 delay-100",
          )}
          aria-hidden={open}
        >
          <Tooltip content={t("openTitle")} side="right" variant="light">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={t("openAria")}
              tabIndex={open ? -1 : 0}
              className={cn(
                "inline-flex flex-col items-center gap-2 rounded px-1 py-2 text-white/70",
                "hover:bg-white/10 hover:text-white",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              )}
            >
              <PanelLeftOpen className="h-5 w-5" />
              <span
                aria-hidden
                className="select-none text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]"
              >
                {activeTabLabel}
              </span>
            </button>
          </Tooltip>
        </div>

        {/* Open panel layout — fixed at full open width, clipped by the
            outer overflow-hidden while collapsing. */}
        <div
          className={cn(
            "absolute left-0 top-0 flex h-full w-72 flex-col sm:w-80 transition-opacity",
            open
              ? "opacity-100 duration-200 delay-100"
              : "pointer-events-none opacity-0 duration-100",
          )}
          aria-hidden={!open}
        >
          <header className="flex items-end justify-between gap-2 border-b border-white/10 px-4 pt-5 sm:px-6">
            {tabStrip}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("closeAria")}
              tabIndex={open ? 0 : -1}
              className="mb-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </header>
          {panelBody}
        </div>
      </aside>
    );
  }

  // Mobile (< sm): always-inline 40px rail + always-mounted overlay
  // that animates in/out (backdrop fade + panel slide-from-left). The
  // chat content underneath is never pushed.
  return (
    <aside
      aria-label={t("drawerAria")}
      className={cn(
        "flex h-full w-[42px] shrink-0 flex-col items-center pt-5",
        "bg-[var(--color-brand)]",
      )}
    >
      <Tooltip
        content={open ? t("closeAria") : t("openTitle")}
        side="right"
        variant="light"
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? t("closeAria") : t("openAria")}
          aria-expanded={open}
          className={cn(
            "tap-target inline-flex flex-col items-center gap-2 rounded px-1 py-2 text-white/70",
            "hover:bg-white/10 hover:text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          )}
        >
          {open ? (
            <PanelLeftClose className="h-5 w-5" />
          ) : (
            <PanelLeftOpen className="h-5 w-5" />
          )}
          <span
            aria-hidden
            className="select-none text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]"
          >
            {activeTabLabel}
          </span>
        </button>
      </Tooltip>
      <div
        className={cn(
          "fixed inset-0 z-40",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          aria-hidden
          className={cn(
            "absolute inset-0 bg-black/30 transition-opacity ease-out",
            open ? "opacity-100 duration-200" : "opacity-0 duration-150",
          )}
        />
        <div
          ref={mobilePanelRef}
          role="dialog"
          aria-label={t("drawerAria")}
          aria-modal={open}
          className={cn(
            "absolute bottom-0 left-0 top-0 flex w-72 max-w-[85vw] flex-col",
            "bg-[var(--color-brand)]",
            "shadow-[var(--shadow-md)]",
            "transition-transform duration-[220ms] ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <header className="flex items-end justify-between gap-2 border-b border-white/10 px-4 pt-5 sm:px-6">
            {tabStrip}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("closeAria")}
              className="mb-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </header>
          {panelBody}
        </div>
      </div>
    </aside>
  );
}

function DocumentTree({ docs }: { docs: OperatorDocument[] }) {
  const groups = useMemo(() => groupByFolder(docs), [docs]);
  // Folder open state — keyed by folder path. Defaults to closed; root
  // (null) items are always shown.
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const toggle = (folder: string) =>
    setOpenFolders((s) => ({ ...s, [folder]: !s[folder] }));

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g) => {
        const isRoot = g.folder === null;
        const isOpen = isRoot || !!openFolders[g.folder!];
        return (
          <section key={g.folder ?? "__root__"} className="flex flex-col">
            {!isRoot && (
              <button
                type="button"
                onClick={() => toggle(g.folder!)}
                aria-expanded={isOpen}
                className={cn(
                  "flex items-center justify-between gap-2 px-4 py-3 text-left text-[13px] font-medium uppercase tracking-wide text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] sm:px-6",
                  "hover:bg-white/5 hover:text-white",
                  isOpen && "bg-white/5 text-white",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="truncate">{g.folder}</span>
                </span>
                <ChevronRight
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform duration-150",
                    isOpen && "rotate-90",
                  )}
                />
              </button>
            )}
            {isOpen && (
              <ul
                className={cn(
                  "flex flex-col",
                  !isRoot && "bg-black/15",
                )}
              >
                {g.docs.map((d) => (
                  <li key={d.id}>
                    <DocumentLink doc={d} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function groupByFolder(docs: OperatorDocument[]): {
  folder: string | null;
  docs: OperatorDocument[];
}[] {
  const map = new Map<string, OperatorDocument[]>();
  for (const d of docs) {
    const key = d.folderPath ?? "__root__";
    const arr = map.get(key);
    if (arr) arr.push(d);
    else map.set(key, [d]);
  }
  const root = map.get("__root__") ?? [];
  const folders = Array.from(map.keys())
    .filter((k) => k !== "__root__")
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({ folder: k, docs: map.get(k)! }));
  return root.length > 0
    ? [{ folder: null, docs: root }, ...folders]
    : folders;
}

function DocumentLink({ doc }: { doc: OperatorDocument }) {
  const viewer = useFileViewer();
  const Icon = doc.sourceType === "image" ? ImageIcon : FileText;

  return (
    <button
      type="button"
      onClick={() =>
        viewer.open({ kind: "doc", id: doc.id, title: doc.title })
      }
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-[4px] px-4 py-3 pr-10 text-left sm:px-6 sm:pr-12",
        "transition-colors hover:bg-white/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
      )}
    >
      <span className="mt-0.5 shrink-0 text-white/70 group-hover:text-white">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium text-white">
          {doc.title}
        </span>
        {doc.summary && (
          <span className="block truncate text-[13px] text-white/70">
            {doc.summary}
          </span>
        )}
      </span>
    </button>
  );
}
