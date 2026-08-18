"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { buttonClasses } from "@/components/ui/button";
import { fetchWithAuth } from "@/auth/authApi";
import { getQrToken } from "@/auth/qrStorage";
import { cn } from "@/lib/utils";
import type { KnowledgeDrawerSource } from "@/components/KnowledgeDrawer";
import type {
  OperatorConversationListItem,
  OperatorConversationsResponse,
} from "@/app/api/conversations/route";

// The Conversations tab of the left drawer: the operator's own chat
// history for the current chat target, newest first. Selecting a row
// hands the id up to the chat, which loads the transcript and lets the
// operator carry on in the same thread.
//
// Scoped exactly like the Documents tab — a machine chat lists that
// machine's conversations, a fleet chat lists the account-wide ones.
// That isn't only for symmetry: a conversation's scope is fixed in the
// database at creation, so a row from another machine could not be
// resumed here anyway.

const PER_PAGE = 25;

export function ConversationList({
  source,
  activeConversationId,
  onSelect,
  loadingConversationId,
}: {
  source: KnowledgeDrawerSource;
  // The conversation currently open in the chat, highlighted in the
  // list. Also the refresh trigger: when the chat starts a new one, the
  // list refetches so it appears at the top.
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  // Set while the chat is fetching a transcript, so the row that was
  // clicked can show a spinner instead of the list going quiet.
  loadingConversationId: string | null;
}) {
  const t = useTranslations("knowledgeDrawer");
  const locale = useLocale();
  const [items, setItems] = useState<OperatorConversationListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Primitive deps so the fetch doesn't re-run every time the parent
  // rebuilds the source object.
  const sourceKind = source.kind;
  const sourceId =
    source.kind === "machine" ? source.machineId : source.accountId;

  const buildUrl = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams({
        scope: sourceKind,
        page: String(nextPage),
        perPage: String(PER_PAGE),
      });
      params.set(sourceKind === "machine" ? "machineId" : "accountId", sourceId);
      // Fleet is bearer-only; a QR session never reaches that branch.
      const qrToken = sourceKind === "machine" ? getQrToken() : null;
      if (qrToken) params.set("qrToken", qrToken);
      return `/api/conversations?${params.toString()}`;
    },
    [sourceKind, sourceId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(buildUrl(0));
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const body = (await res.json()) as OperatorConversationsResponse;
      setItems(body.conversations);
      setHasMore(body.hasMore);
      setPage(0);
    } catch (err) {
      console.error("Conversation list load failed", err);
      setError(t("conversationsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [buildUrl, t]);

  async function loadMore() {
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const res = await fetchWithAuth(buildUrl(nextPage));
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const body = (await res.json()) as OperatorConversationsResponse;
      setItems((prev) => [...(prev ?? []), ...body.conversations]);
      setHasMore(body.hasMore);
      setPage(nextPage);
    } catch (err) {
      console.error("Conversation list page load failed", err);
      setError(t("conversationsLoadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  // Refetch on mount (the tab only mounts when selected) and whenever
  // the chat switches to a different conversation — that's the signal a
  // new row exists, or an existing one just grew.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, activeConversationId]);

  if (loading && !items) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  if (error && !items) {
    return (
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
    );
  }

  if (items && items.length === 0) {
    return (
      <div className="px-4 py-8 text-center sm:px-6">
        <p className="text-[15px] text-white/70">{t("conversationsEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {(items ?? []).map((c) => (
          <li key={c.id}>
            <ConversationRow
              item={c}
              locale={locale}
              active={c.id === activeConversationId}
              loading={c.id === loadingConversationId}
              onSelect={() => onSelect(c.id)}
            />
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="px-4 pt-3 sm:px-6">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className={buttonClasses({
              variant: "secondary",
              className: "w-full gap-2",
            })}
          >
            {loadingMore && <Spinner className="h-4 w-4" />}
            <span>{t("showMore")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ConversationRow({
  item,
  locale,
  active,
  loading,
  onSelect,
}: {
  item: OperatorConversationListItem;
  locale: string;
  active: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("knowledgeDrawer");
  const stamp = item.lastMessageAt ?? item.startedAt;
  const date = new Date(stamp);
  const dateLabel = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-[4px] px-4 py-3 text-left sm:px-6",
        "transition-colors hover:bg-white/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        active && "bg-white/15",
      )}
    >
      <span className="mt-0.5 shrink-0 text-white/70 group-hover:text-white">
        {loading ? (
          <Spinner className="h-5 w-5" />
        ) : (
          <MessageSquare className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium text-white">
          {item.title ?? t("conversationUntitled")}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-white/70">
          <time dateTime={date.toISOString()}>{dateLabel}</time>
          <span aria-hidden>·</span>
          <span>{t("questionCount", { count: item.questionCount })}</span>
        </span>
      </span>
    </button>
  );
}
