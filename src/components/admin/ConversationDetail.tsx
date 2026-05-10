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
  Wrench,
} from "lucide-react";
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
        setError(err instanceof Error ? err.message : "Ukendt fejl");
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
      <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 text-[14px] text-red-600">
        {error ?? "Samtalen kunne ikke hentes"}
      </div>
    );
  }

  const totalIn = data.messages.reduce((s, m) => s + (m.tokensIn ?? 0), 0);
  const totalOut = data.messages.reduce((s, m) => s + (m.tokensOut ?? 0), 0);
  const cacheHits = data.messages.filter((m) => m.cacheHit).length;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/admin/machines/${machineId}/conversations`}
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Alle samtaler
      </Link>

      <section className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6">
        <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-foreground)]">
          Samtale fra {DA_DT.format(new Date(data.startedAt))}
        </h1>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-3">
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted-foreground)]">Operatør</dt>
            <dd className="text-[var(--color-foreground)]">
              {data.userName ?? data.userEmail ?? "—"}
              {data.userName && data.userEmail && (
                <span className="ml-1 text-[var(--color-muted-foreground)]">
                  ({data.userEmail})
                </span>
              )}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted-foreground)]">Beskeder</dt>
            <dd className="text-[var(--color-foreground)]">
              {data.messages.length}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted-foreground)]">Tokens</dt>
            <dd className="text-[var(--color-foreground)]">
              {totalIn.toLocaleString()} ind / {totalOut.toLocaleString()} ud
              {cacheHits > 0 && (
                <span className="ml-1 text-[var(--color-muted-foreground)]">
                  ({cacheHits}× cache)
                </span>
              )}
            </dd>
          </div>
        </dl>
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
  const time = TIME.format(new Date(message.createdAt));

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[78%] flex-col items-end gap-1">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Operatør · {time}
          </span>
          <div
            className="rounded-[var(--radius-lg)] rounded-br-[10px] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap shadow-[var(--shadow-sm)]"
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
            · {message.tokensIn} → {message.tokensOut} tokens
            {message.cacheHit && " · cache hit"}
          </span>
        )}
      </span>
      {message.content ? (
        <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 text-[15px]">
          <Markdown>{message.content}</Markdown>
        </div>
      ) : message.toolName ? (
        <div className="rounded-[var(--radius)] border border-dashed border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-3 text-[13px] text-[var(--color-muted-foreground)]">
          (kun tool-kald — se nedenstående tool-besked)
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
  const [showInput, setShowInput] = useState(false);
  const query =
    typeof message.toolInput === "object" &&
    message.toolInput &&
    "query" in (message.toolInput as Record<string, unknown>)
      ? String((message.toolInput as { query: unknown }).query ?? "")
      : null;

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-muted)]/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-[var(--color-muted-foreground)]">
          <Wrench className="h-3.5 w-3.5" />
          <span className="font-medium text-[var(--color-foreground)]">
            {message.toolName ?? "tool"}
          </span>
          {query && (
            <>
              <Search className="h-3 w-3" />
              <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[12px]">
                {query}
              </code>
            </>
          )}
          <span>· {time}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowInput((v) => !v)}
          className="text-[12px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          {showInput ? "Skjul input" : "Vis input"}
        </button>
      </div>
      {showInput && (
        <pre className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 text-[12px]">
          {JSON.stringify(message.toolInput, null, 2)}
        </pre>
      )}
      {message.chunks && message.chunks.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            Chunks AI&#39;en så ({message.chunks.length})
          </p>
          {message.chunks.map((c) => (
            <ChunkRow key={c.id} chunk={c} />
          ))}
        </div>
      )}
      {message.chunks && message.chunks.length === 0 && message.toolName === "search_kb" && (
        <p className="mt-3 text-[12px] italic text-[var(--color-muted-foreground)]">
          Ingen chunks fandt match.
        </p>
      )}
    </div>
  );
}

function ChunkRow({ chunk }: { chunk: AdminChunkRef }) {
  const [open, setOpen] = useState(false);
  const pages =
    chunk.pageFrom == null
      ? null
      : chunk.pageTo && chunk.pageTo !== chunk.pageFrom
        ? `s. ${chunk.pageFrom}–${chunk.pageTo}`
        : `s. ${chunk.pageFrom}`;

  return (
    <div className="rounded-[var(--radius)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        )}
        <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        <span className="font-medium text-[var(--color-foreground)]">
          {chunk.documentTitle}
        </span>
        <span className="text-[12px] text-[var(--color-muted-foreground)]">
          chunk #{chunk.ordinal}
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
