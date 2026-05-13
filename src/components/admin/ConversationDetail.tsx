"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Search,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";
import {
  getAdminConversation,
  type AdminChunkRef,
  type AdminConversationDetail,
  type AdminConversationMessage,
} from "@/admin/adminApi";

const DA_DT = new Intl.DateTimeFormat("da-DK", {
  dateStyle: "short",
  timeStyle: "short",
});

const TIME = new Intl.DateTimeFormat("da-DK", {
  timeStyle: "short",
});

export function ConversationDetail({
  machineId,
  conversationId,
}: {
  machineId: string;
  conversationId: string;
}) {
  const t = useTranslations("admin.conversationDetail");
  const tc = useTranslations("common");
  const [data, setData] = useState<AdminConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminConversation(conversationId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : tc("unknownError"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[14px] text-red-600">
        {error ?? t("fetchFailed")}
      </div>
    );
  }

  const totalIn = data.messages.reduce((s, m) => s + (m.tokensIn ?? 0), 0);
  const totalOut = data.messages.reduce((s, m) => s + (m.tokensOut ?? 0), 0);
  const cacheHits = data.messages.filter((m) => m.cacheHit).length;

  return (
    <div className="flex flex-col gap-5 sm:gap-6">
      <Link
        href={`/admin/machines/${machineId}/conversations`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("backAll")}
      </Link>

      <section className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 sm:p-6">
        <h1 className="text-[18px] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[20px]">
          {t("heading", { date: DA_DT.format(new Date(data.startedAt)) })}
        </h1>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            <dt className="text-[var(--color-muted-foreground)]">{t("operator")}</dt>
            <dd className="min-w-0 break-words text-[var(--color-foreground)]">
              {data.userName ?? data.userEmail ?? "—"}
              {data.userName && data.userEmail && (
                <span className="ml-1 text-[var(--color-muted-foreground)]">
                  ({data.userEmail})
                </span>
              )}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            <dt className="text-[var(--color-muted-foreground)]">{t("messages")}</dt>
            <dd className="text-[var(--color-foreground)]">
              {data.messages.length}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            <dt className="text-[var(--color-muted-foreground)]">{t("tokens")}</dt>
            <dd className="text-[var(--color-foreground)]">
              {t("tokensValue", { tokensIn: totalIn.toLocaleString(), tokensOut: totalOut.toLocaleString() })}
              {cacheHits > 0 && (
                <span className="ml-1 text-[var(--color-muted-foreground)]">
                  {t("cacheHits", { n: cacheHits })}
                </span>
              )}
            </dd>
          </div>
        </dl>

        {data.escalation && (
          <div className="mt-5 flex items-start gap-3 rounded-[4px] border border-amber-200 bg-amber-50 p-3 text-[14px] sm:p-4">
            <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium text-amber-900">
                {t("escalatedToPrefix")}{" "}
                {data.escalation.channel === "sms"
                  ? t("channelSms")
                  : data.escalation.channel === "email"
                    ? t("channelEmail")
                    : data.escalation.channel === "webhook"
                      ? t("channelWebhook")
                      : t("channelServiceTicket")}{" "}
                <span className="font-mono break-all">{data.escalation.target}</span>
              </p>
              {data.escalation.note && (
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-[var(--color-foreground)]">
                  <span className="text-[var(--color-muted-foreground)]">
                    {t("operatorDescription")}{" "}
                  </span>
                  {data.escalation.note}
                </p>
              )}
              <p className="mt-1 text-[12px] text-[var(--color-muted-foreground)]">
                {DA_DT.format(new Date(data.escalation.createdAt))}
                {data.escalation.createdBy && t("escalationBy", { by: data.escalation.createdBy })}
                {data.escalation.shareToken && (
                  <>
                    {" · "}
                    <a
                      href={`/escalation/${data.escalation.shareToken}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-800 underline hover:text-amber-900"
                    >
                      {t("openTechnicianLink")}
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        {data.feedback && (
          <div
            className={cn(
              "mt-5 flex items-start gap-3 rounded-[4px] border p-3 text-[14px] sm:p-4",
              data.feedback.resolved
                ? "border-emerald-200 bg-emerald-50"
                : "border-red-200 bg-red-50",
            )}
          >
            {data.feedback.resolved ? (
              <ThumbsUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            ) : (
              <ThumbsDown className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "font-medium",
                  data.feedback.resolved ? "text-emerald-800" : "text-red-800",
                )}
              >
                {data.feedback.resolved
                  ? t("operatorMarkedResolved")
                  : t("operatorMarkedUnresolved")}
              </p>
              {data.feedback.solutionText && (
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-[var(--color-foreground)]">
                  <span className="text-[var(--color-muted-foreground)]">
                    {t("whatWorked")}{" "}
                  </span>
                  {data.feedback.solutionText}
                </p>
              )}
              <p className="mt-1 text-[12px] text-[var(--color-muted-foreground)]">
                {DA_DT.format(new Date(data.feedback.createdAt))}
                {data.feedback.promotedDocId && t("promotedToKb")}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {data.messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </section>
    </div>
  );
}

function MessageRow({ message }: { message: AdminConversationMessage }) {
  const t = useTranslations("admin.conversationDetail");
  const time = TIME.format(new Date(message.createdAt));

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[92%] flex-col items-end gap-1 sm:max-w-[78%]">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {t("operatorRole")} · {time}
          </span>
          <div
            className="rounded-[4px] px-3 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap shadow-[var(--shadow-sm)] sm:px-4 sm:py-3"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-primary-foreground)",
            }}
          >
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  if (message.role === "tool") {
    return <ToolMessage message={message} time={time} />;
  }

  // assistant
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        OptiAI · {time}
        {message.tokensIn != null && message.tokensOut != null && (
          <span className="ml-1 normal-case">
            {" "}
            {t("tokensInOutShort", { tokensIn: message.tokensIn, tokensOut: message.tokensOut })}
            {message.cacheHit && t("cacheHit")}
          </span>
        )}
      </span>
      {message.content ? (
        <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 text-[15px] sm:p-4">
          <Markdown>{message.content}</Markdown>
        </div>
      ) : message.toolName ? (
        <div className="rounded-[4px] border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-3 text-[13px] text-[var(--color-muted-foreground)] sm:px-4">
          {t("toolCallsOnly")}
        </div>
      ) : null}
    </div>
  );
}

function ToolMessage({
  message,
  time,
}: {
  message: AdminConversationMessage;
  time: string;
}) {
  const t = useTranslations("admin.conversationDetail");
  const [showInput, setShowInput] = useState(false);
  const query =
    typeof message.toolInput === "object" &&
    message.toolInput &&
    "query" in (message.toolInput as Record<string, unknown>)
      ? String((message.toolInput as { query: unknown }).query ?? "")
      : null;

  return (
    <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-muted)]/40 p-3 sm:p-4">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[var(--color-muted-foreground)]">
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium text-[var(--color-foreground)]">
            {message.toolName ?? t("toolFallback")}
          </span>
          {query && (
            <>
              <Search className="h-3 w-3 shrink-0" />
              <code className="min-w-0 max-w-full truncate rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[12px]">
                {query}
              </code>
            </>
          )}
          <span>· {time}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowInput((v) => !v)}
          className="shrink-0 text-[12px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          {showInput ? t("hideInput") : t("showInput")}
        </button>
      </div>
      {showInput && (
        <pre className="mt-3 overflow-x-auto rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 text-[12px]">
          {JSON.stringify(message.toolInput, null, 2)}
        </pre>
      )}
      {message.chunks && message.chunks.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {t("chunksAiSaw", { n: message.chunks.length })}
          </p>
          {message.chunks.map((c) => (
            <ChunkRow key={c.id} chunk={c} />
          ))}
        </div>
      )}
      {message.chunks && message.chunks.length === 0 && message.toolName === "search_kb" && (
        <p className="mt-3 text-[12px] italic text-[var(--color-muted-foreground)]">
          {t("noChunksMatch")}
        </p>
      )}
    </div>
  );
}

function ChunkRow({ chunk }: { chunk: AdminChunkRef }) {
  const t = useTranslations("admin.conversationDetail");
  const [open, setOpen] = useState(false);
  const pages =
    chunk.pageFrom == null
      ? null
      : chunk.pageTo && chunk.pageTo !== chunk.pageFrom
        ? t("pageRange", { from: chunk.pageFrom, to: chunk.pageTo })
        : t("pageSingle", { n: chunk.pageFrom });

  return (
    <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-left text-[13px]"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        )}
        <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        <span className="min-w-0 break-words font-medium text-[var(--color-foreground)]">
          {chunk.documentTitle}
        </span>
        <span className="text-[12px] text-[var(--color-muted-foreground)]">
          {t("chunkLabel", { n: chunk.ordinal })}
          {pages ? ` · ${pages}` : ""}
        </span>
      </button>
      {open && (
        <pre className="border-t border-[var(--color-hairline)] bg-[var(--color-background)] px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--color-foreground)]">
          {chunk.text}
        </pre>
      )}
    </div>
  );
}
