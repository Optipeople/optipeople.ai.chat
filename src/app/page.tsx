"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react";
import type { EscalateResponse } from "@/app/api/chat/escalate/route";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { OptipeopleLogo } from "@/components/logo";
import { LoginScreen } from "@/components/LoginScreen";
import { AccountSelectScreen } from "@/components/AccountSelectScreen";
import { MachineSelectScreen } from "@/components/MachineSelectScreen";
import { UserMenu } from "@/components/UserMenu";
import { useAuth } from "@/auth/AuthContext";
import { fetchWithAuth } from "@/auth/authApi";
import {
  clearQrSession,
  getQrMachine,
  getQrToken,
  saveQrSession,
  type QrMachineInfo,
} from "@/auth/qrStorage";
import { cn } from "@/lib/utils";

// Deep-link helper: super-admins navigate from /admin/machines to a
// pre-selected chat via /?account=…&machine=…. We watch the auth state,
// pick the right account+machine once the relevant lists have loaded,
// then strip the params from the URL so a refresh doesn't keep firing.
function useDeepLinkSelection() {
  const {
    accounts,
    machines,
    currentAccount,
    currentMachine,
    selectAccount,
    selectMachine,
    isLoadingAccounts,
    isLoadingMachines,
  } = useAuth();

  const [pending, setPending] = useState<{
    account: string | null;
    machine: string | null;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const account = params.get("account");
    const machine = params.get("machine");
    if (account || machine) {
      setPending({ account, machine });
      // Clean the URL once we've captured the intent.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!pending) return;
    if (
      pending.account &&
      currentAccount?.id !== pending.account &&
      !isLoadingAccounts &&
      accounts.some((a) => a.id === pending.account)
    ) {
      selectAccount(pending.account);
    }
  }, [pending, accounts, currentAccount, isLoadingAccounts, selectAccount]);

  useEffect(() => {
    if (!pending) return;
    if (
      pending.machine &&
      (!pending.account || currentAccount?.id === pending.account) &&
      currentMachine?.id !== pending.machine &&
      !isLoadingMachines &&
      machines.some((m) => m.id === pending.machine)
    ) {
      selectMachine(pending.machine);
      setPending(null);
    } else if (pending && !pending.machine && currentAccount?.id === pending.account) {
      setPending(null);
    }
  }, [
    pending,
    machines,
    currentMachine,
    currentAccount,
    isLoadingMachines,
    selectMachine,
  ]);
}

type Role = "user" | "assistant";
type SourceRef = {
  id: string;
  title: string;
  pageFrom: number | null;
};
interface Message {
  role: Role;
  content: string;
  sources?: SourceRef[];
}

const SAMPLE_QUESTIONS = [
  "Hvordan fjerner jeg alarm 731?",
  "Vis mig værktøjsskift-proceduren",
  "Hvad står der på vedligeholdelses-tjeklisten?",
];

type ChatTarget = {
  account: { id: string; name: string };
  machine: { id: string; name: string };
};

export default function Home() {
  const [qrPhase, setQrPhase] = useState<
    | { kind: "checking" }
    | { kind: "active"; target: ChatTarget }
    | { kind: "error"; message: string }
    | { kind: "none" }
  >({ kind: "checking" });

  // QR resolution runs once on mount, BEFORE the regular auth gate
  // renders, so a sticker scan never shows the login screen. The token
  // arrives via ?qr=… on first load; we strip it from the URL and
  // stash it in sessionStorage so refreshes stay anchored.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("qr");
    const storedToken = getQrToken();
    const storedMachine = getQrMachine();
    const token = urlToken ?? storedToken;

    if (!token) {
      setQrPhase({ kind: "none" });
      return;
    }

    // Fast path: token already in sessionStorage from a previous
    // resolve in this tab. Reuse the cached machine info instead of
    // re-hitting the network on every refresh.
    if (!urlToken && storedToken && storedMachine) {
      setQrPhase({
        kind: "active",
        target: {
          account: { id: storedMachine.accountId, name: "" },
          machine: { id: storedMachine.id, name: storedMachine.name ?? "" },
        },
      });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/qr/resolve?token=${encodeURIComponent(token)}`,
        );
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "QR-koden er ugyldig eller er blevet inaktiveret."
              : `Fejl ved QR-opslag (${res.status})`,
          );
        }
        const body = (await res.json()) as {
          machineId: string;
          accountId: string;
          machineName: string | null;
        };
        if (cancelled) return;
        const info: QrMachineInfo = {
          id: body.machineId,
          accountId: body.accountId,
          name: body.machineName,
        };
        saveQrSession(token, info);
        // Strip ?qr= from the URL so the token isn't visible / re-used
        // on subsequent navigations. sessionStorage carries it onward.
        if (urlToken) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        setQrPhase({
          kind: "active",
          target: {
            account: { id: body.accountId, name: "" },
            machine: { id: body.machineId, name: body.machineName ?? "" },
          },
        });
      } catch (err) {
        if (cancelled) return;
        clearQrSession();
        setQrPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Ukendt fejl",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const {
    user,
    isInitializing,
    currentAccount,
    accountsForbidden,
    currentMachine,
    machinesForbidden,
  } = useAuth();
  useDeepLinkSelection();

  // QR session resolution outranks the Optipeople login flow.
  if (qrPhase.kind === "checking") {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }
  if (qrPhase.kind === "error") {
    return <QrErrorScreen message={qrPhase.message} />;
  }
  if (qrPhase.kind === "active") {
    return <ChatApp account={qrPhase.target.account} machine={qrPhase.target.machine} />;
  }

  if (isInitializing) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (!user) return <LoginScreen />;
  if (!currentAccount && !accountsForbidden) return <AccountSelectScreen />;
  // Operator-role users (accountsForbidden) have no account context and
  // therefore can't pick a machine either — skip straight to chat.
  if (currentAccount && !currentMachine && !machinesForbidden) {
    return <MachineSelectScreen />;
  }

  return (
    <ChatApp
      account={
        currentAccount ? { id: currentAccount.id, name: currentAccount.name } : null
      }
      machine={
        currentMachine ? { id: currentMachine.id, name: currentMachine.name } : null
      }
    />
  );
}

function QrErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background)] p-6">
      <div className="max-w-md rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-[16px] font-medium text-red-800">QR-koden virker ikke</p>
        <p className="mt-2 text-[14px] text-red-700">{message}</p>
        <p className="mt-4 text-[12px] text-red-700/80">
          Bed en super-admin om at generere en ny QR-kode for maskinen.
        </p>
      </div>
    </div>
  );
}

// 10 minutes of no chat activity (no streaming, no typing, no send) auto-
// prompts the operator to mark resolution. Long enough that they aren't
// nagged mid-task; short enough that the prompt still has context.
const IDLE_FEEDBACK_MS = 10 * 60 * 1000;

type FeedbackState =
  | { phase: "hidden" }
  | { phase: "prompt" }
  | { phase: "answered_yes"; solution: string; submitting: boolean }
  | { phase: "submitting" }
  | { phase: "thanks"; resolved: boolean }
  | { phase: "error"; message: string };

// Operator-side escalation flow. The "Tilkald service" pill button
// transitions hidden → confirm. On submit we POST /api/chat/escalate,
// move to submitting, and on success either auto-open tel:/mailto: or
// land on `done` with the share URL for copy.
type EscalateState =
  | { phase: "hidden" }
  | { phase: "confirm"; note: string }
  | { phase: "submitting"; note: string }
  | {
      phase: "done";
      channel: EscalateResponse["channel"];
      target: string;
      label: string | null;
      shareUrl: string;
    }
  | { phase: "error"; message: string };

function ChatApp({
  account,
  machine,
}: {
  account: { id: string; name: string } | null;
  machine: { id: string; name: string } | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // Server creates a conversations row on the first request and streams
  // its id back. We thread it on subsequent requests so all turns end up
  // grouped together for the audit view. Reset whenever the operator
  // switches machines so the new chat starts a fresh row.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({ phase: "hidden" });
  const [escalate, setEscalate] = useState<EscalateState>({ phase: "hidden" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const pendingRef = useRef("");
  const streamDoneRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Switching machine = new conversation context. Drop any prior id
    // and clear messages — operator likely wants a fresh slate.
    setConversationId(null);
    setMessages([]);
    setFeedback({ phase: "hidden" });
    setEscalate({ phase: "hidden" });
  }, [machine?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      abortRef.current?.abort();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  // Idle prompt: arm a timer when the chat is settled (we have a
  // conversation, no streaming, no card already showing). Clear on any
  // activity. When it fires, surface the resolution card.
  const armIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Only auto-prompt if we still have a conversation and nothing is
      // happening — guards against the prompt flashing while the operator
      // started typing right at the deadline.
      setFeedback((prev) => (prev.phase === "hidden" ? { phase: "prompt" } : prev));
    }, IDLE_FEEDBACK_MS);
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (
      conversationId &&
      !streaming &&
      feedback.phase === "hidden" &&
      messages.some((m) => m.role === "assistant" && m.content.length > 0)
    ) {
      armIdleTimer();
      return clearIdleTimer;
    }
    clearIdleTimer();
    return undefined;
  }, [
    conversationId,
    streaming,
    feedback.phase,
    messages,
    armIdleTimer,
    clearIdleTimer,
  ]);

  function startNewConversation() {
    abortRef.current?.abort();
    pendingRef.current = "";
    streamDoneRef.current = false;
    setStreaming(false);
    setMessages([]);
    setConversationId(null);
    setFeedback({ phase: "hidden" });
    setEscalate({ phase: "hidden" });
    setInput("");
  }

  async function submitFeedback(resolved: boolean, solutionText?: string) {
    if (!conversationId) return;
    setFeedback(
      resolved && solutionText !== undefined
        ? { phase: "answered_yes", solution: solutionText, submitting: true }
        : { phase: "submitting" },
    );
    try {
      const res = await fetchWithAuth("/api/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          resolved,
          solutionText: solutionText && solutionText.trim().length > 0
            ? solutionText
            : null,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Server error ${res.status}${txt ? `: ${txt}` : ""}`);
      }
      setFeedback({ phase: "thanks", resolved });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ phase: "error", message: msg });
    }
  }

  async function submitEscalation(note: string) {
    if (!conversationId) return;
    setEscalate({ phase: "submitting", note });
    try {
      const res = await fetchWithAuth("/api/chat/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        throw new Error(
          body.error ?? `Server error ${res.status}`,
        );
      }
      const data = (await res.json()) as EscalateResponse;

      // Phone channel: open tel: from the click-handler descendant.
      // Email channel: server already sent via Resend — no client open.
      // Service-ticket: nothing to open; the `done` view exposes the
      // share URL for copy.
      if (data.channel === "phone") {
        window.location.href = `tel:${data.target}`;
      }

      // Lock the chat (escalate.phase === "done" hides the feedback
      // prompt and locks the input bar) so the operator doesn't keep
      // typing as if the conversation is still live.
      setFeedback({ phase: "hidden" });
      setEscalate({
        phase: "done",
        channel: data.channel,
        target: data.target,
        label: data.label,
        shareUrl: data.shareUrl,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setEscalate({ phase: "error", message: msg });
    }
  }

  function startDrain() {
    if (rafRef.current !== null) return;
    const tick = () => {
      const buf = pendingRef.current;
      if (buf.length === 0) {
        if (streamDoneRef.current) {
          rafRef.current = null;
          setStreaming(false);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const chunkSize = Math.max(1, Math.ceil(buf.length / 60));
      const slice = buf.slice(0, chunkSize);
      pendingRef.current = buf.slice(chunkSize);

      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, content: last.content + slice };
        return copy;
      });

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || streaming) return;
    // Any send means the operator isn't done — drop the idle prompt
    // (and any in-flight feedback state) so it doesn't sit there stale.
    clearIdleTimer();
    if (feedback.phase !== "hidden") setFeedback({ phase: "hidden" });

    const next: Message[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMessages(next);
    setInput("");
    setStreaming(true);
    pendingRef.current = "";
    streamDoneRef.current = false;
    startDrain();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetchWithAuth("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          accountId: account?.id ?? null,
          machineId: machine?.id ?? null,
          conversationId,
          messages: next
            .slice(0, -1)
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const chunk of events) {
          const lines = chunk.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(6));

          if (event === "delta") {
            pendingRef.current += data.text;
          } else if (event === "conversation") {
            if (typeof data.id === "string") setConversationId(data.id);
          } else if (event === "sources") {
            if (Array.isArray(data.sources)) {
              const sources = data.sources as SourceRef[];
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = { ...last, sources };
                }
                return copy;
              });
            }
          } else if (event === "error") {
            pendingRef.current = "";
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = {
                role: "assistant",
                content: `Fejl: ${data.message}`,
              };
              return copy;
            });
          }
        }
      }
    } catch (err: unknown) {
      // Caller-initiated aborts (component unmount, machine switch) aren't
      // errors — just stop quietly so the UI doesn't flash "Fejl: …".
      if (controller.signal.aborted) {
        pendingRef.current = "";
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        pendingRef.current = "";
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: `Fejl: ${msg}`,
          };
          return copy;
        });
      }
    } finally {
      streamDoneRef.current = true;
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isEmpty = messages.length === 0;
  const hasAssistantReply = messages.some(
    (m) => m.role === "assistant" && m.content.length > 0,
  );
  const inputLocked =
    streaming || feedback.phase === "thanks" || escalate.phase === "done";
  const canSend = !inputLocked && input.trim().length > 0;
  const showActionButtons =
    !!conversationId &&
    hasAssistantReply &&
    feedback.phase === "hidden" &&
    (escalate.phase === "hidden" || escalate.phase === "error");

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-background)]">
      <header
        className="relative z-20 shrink-0"
        style={{ backgroundColor: "var(--color-brand)" }}
      >
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <OptipeopleLogo className="h-7 w-auto text-white" aria-label="Optipeople" />
          <UserMenu />
        </div>
      </header>

      <div ref={scrollRef} className="scroll-area flex-1 overflow-y-auto">
        {/* pb sized to clear the absolutely-positioned footer (24px fade
            + solid panel containing the input bar, optional "Afslut
            samtale" pill, and feedback card). Without enough room here,
            content scrolls under the panel. */}
        <div className="mx-auto max-w-3xl px-6 pt-12 pb-56">
          {isEmpty ? (
            <p className="msg-in max-w-2xl text-[22px] leading-[1.55] tracking-[-0.005em] text-[var(--color-foreground)]">
              Spørg om installation, vedligeholdelse, værktøjsskift, alarmer
              eller hvad som helst i din maskines manual.
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              {messages.map((m, i) => (
                <MessageRow key={i} message={m} />
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        {/* Soft fade above the solid panel — pure transparent → background.
            Sized small (24px) since the panel below now does the heavy
            lifting of hiding scroll content. */}
        <div
          aria-hidden
          className="pointer-events-none h-6 w-full"
          style={{
            background:
              "linear-gradient(to top, var(--color-background) 0%, oklch(from var(--color-background) l c h / 0%) 100%)",
          }}
        />
        {/* Full-width solid panel — covers the chat behind the input bar,
            the "Afslut samtale" pill row, and the feedback card. Without
            this, gaps to the sides of those (max-w-3xl) elements let
            scroll content bleed through. */}
        <div className="pointer-events-auto w-full bg-[var(--color-background)]">
        <div className="mx-auto max-w-3xl px-4 pb-8 pt-2">
          {isEmpty && (
            <div className="msg-in mb-3 flex flex-wrap gap-2">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  disabled={streaming}
                  className={cn(
                    "rounded-full bg-[var(--color-surface)] px-4 py-2.5 text-[16px] text-[var(--color-foreground)]",
                    "border border-[var(--color-hairline)] shadow-[var(--shadow-sm)]",
                    "transition-[transform,border-color,box-shadow] duration-200 ease-[var(--ease-apple)]",
                    "hover:-translate-y-[1px] hover:border-[var(--color-brand)]/40 hover:shadow-[var(--shadow-md)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                    "disabled:opacity-60 disabled:hover:translate-y-0",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {showActionButtons && (
            <div className="msg-in mb-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEscalate({ phase: "confirm", note: "" })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface)] px-3.5 py-1.5 text-[13px] text-[var(--color-muted-foreground)]",
                  "border border-[var(--color-hairline)] shadow-[var(--shadow-sm)]",
                  "transition-colors hover:text-amber-700 hover:border-amber-300",
                )}
              >
                <Wrench className="h-3.5 w-3.5" />
                Tilkald service
              </button>
              <button
                type="button"
                onClick={() => setFeedback({ phase: "prompt" })}
                className={cn(
                  "rounded-full bg-[var(--color-surface)] px-3.5 py-1.5 text-[13px] text-[var(--color-muted-foreground)]",
                  "border border-[var(--color-hairline)] shadow-[var(--shadow-sm)]",
                  "transition-colors hover:text-[var(--color-foreground)] hover:border-[var(--color-brand)]/40",
                )}
              >
                Afslut samtale
              </button>
            </div>
          )}
          {escalate.phase !== "hidden" && (
            <div className="msg-in mb-3">
              <EscalateCard
                state={escalate}
                onSubmit={submitEscalation}
                onNoteChange={(note) =>
                  setEscalate((prev) =>
                    prev.phase === "confirm" ? { ...prev, note } : prev,
                  )
                }
                onCancel={() => setEscalate({ phase: "hidden" })}
                onStartNew={startNewConversation}
              />
            </div>
          )}
          {feedback.phase !== "hidden" && (
            <div className="msg-in mb-3">
              <FeedbackCard
                state={feedback}
                onAnswerYes={() =>
                  setFeedback({
                    phase: "answered_yes",
                    solution: "",
                    submitting: false,
                  })
                }
                onAnswerNo={() => submitFeedback(false)}
                onSubmitYes={(solution) => submitFeedback(true, solution)}
                onSolutionChange={(solution) =>
                  setFeedback((prev) =>
                    prev.phase === "answered_yes"
                      ? { ...prev, solution }
                      : prev,
                  )
                }
                onDismiss={() => setFeedback({ phase: "hidden" })}
                onStartNew={startNewConversation}
              />
            </div>
          )}
          <div
            className={cn(
              "flex items-end gap-3 rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-2.5",
              "border border-[var(--color-hairline)] shadow-[var(--shadow-lg)]",
              "transition-[border-color,box-shadow] duration-300",
              "focus-within:border-[var(--color-brand)]/30",
              inputLocked && "opacity-60",
            )}
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                feedback.phase === "thanks"
                  ? "Samtalen er afsluttet. Start en ny ovenfor."
                  : "Skriv dit spørgsmål her…"
              }
              rows={1}
              disabled={inputLocked}
              className="min-h-[48px] max-h-[200px] flex-1 border-0 bg-transparent shadow-none focus:border-0"
            />
            <Button
              onClick={() => send()}
              disabled={!canSend}
              className={cn(
                "h-[52px] min-w-[100px] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]",
                !canSend &&
                  "bg-[var(--color-muted)] text-[var(--color-muted-foreground)] shadow-none hover:bg-[var(--color-muted)]",
              )}
            >
              {streaming ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Send"
              )}
            </Button>
          </div>
        </div>
        </div>
        <div className="brand-stripe" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </footer>
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="msg-in flex justify-end">
        <div
          className="max-w-[78%] rounded-[var(--radius-lg)] rounded-br-[10px] px-5 py-3 text-[19px] leading-[1.55] whitespace-pre-wrap shadow-[var(--shadow-sm)]"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "var(--color-primary-foreground)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  if (!message.content) {
    return (
      <div className="msg-in flex items-center gap-2.5 text-[18px] text-[var(--color-muted-foreground)]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Arbejder…
      </div>
    );
  }

  return (
    <div className="msg-in flex flex-col gap-3">
      <Markdown>{message.content}</Markdown>
      {message.sources && message.sources.length > 0 && (
        <SourceChips sources={message.sources} />
      )}
    </div>
  );
}

function SourceChips({ sources }: { sources: SourceRef[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
        Kilder
      </span>
      {sources.map((s) => (
        <SourceChip key={s.id} source={s} />
      ))}
    </div>
  );
}

function SourceChip({ source }: { source: SourceRef }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (loading) return;
    setError(null);
    setLoading(true);
    // We pop a placeholder window synchronously so the click counts as
    // user-initiated; popup blockers won't fire after the await.
    const popup =
      typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      const res = await fetchWithAuth(
        `/api/documents/${encodeURIComponent(source.id)}/url`,
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Server error ${res.status}${txt ? `: ${txt}` : ""}`);
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) throw new Error("Manglende URL i svaret");
      const target =
        source.pageFrom != null
          ? `${body.url}#page=${source.pageFrom}`
          : body.url;
      if (popup) popup.location.href = target;
      else window.open(target, "_blank");
    } catch (err: unknown) {
      if (popup) popup.close();
      setError(err instanceof Error ? err.message : "Kunne ikke åbne dokument");
    } finally {
      setLoading(false);
    }
  }

  const pageLabel = source.pageFrom != null ? ` · s. ${source.pageFrom}` : "";

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      title={error ?? `Åbn ${source.title}${pageLabel} i ny fane`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface)] px-3 py-1 text-[12px] text-[var(--color-foreground)]",
        "border border-[var(--color-hairline)] shadow-[var(--shadow-sm)]",
        "transition-colors hover:border-[var(--color-brand)]/40 hover:bg-[var(--color-muted)]/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        "disabled:opacity-60",
        error && "border-red-300 text-red-700",
      )}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <FileText className="h-3 w-3" />
      )}
      <span className="max-w-[260px] truncate">{source.title}</span>
      {source.pageFrom != null && (
        <span className="text-[var(--color-muted-foreground)]">
          s. {source.pageFrom}
        </span>
      )}
      <ExternalLink className="h-3 w-3 text-[var(--color-muted-foreground)]" />
    </button>
  );
}

function FeedbackCard({
  state,
  onAnswerYes,
  onAnswerNo,
  onSubmitYes,
  onSolutionChange,
  onDismiss,
  onStartNew,
}: {
  state: FeedbackState;
  onAnswerYes: () => void;
  onAnswerNo: () => void;
  onSubmitYes: (solution: string) => void;
  onSolutionChange: (solution: string) => void;
  onDismiss: () => void;
  onStartNew: () => void;
}) {
  if (state.phase === "thanks") {
    return (
      <div className="rounded-[var(--radius-xl)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-md)]">
        <div className="flex items-start gap-3">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
            aria-hidden
          />
          <div className="flex-1">
            <p className="text-[15px] font-medium text-[var(--color-foreground)]">
              Tak for din feedback.
            </p>
            <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">
              {state.resolved
                ? "Markeret som løst. Det hjælper næste operatør med samme problem."
                : "Markeret som uløst. Vi kigger på det."}
            </p>
          </div>
          <button
            type="button"
            onClick={onStartNew}
            className="rounded-full bg-[var(--color-surface)] px-3.5 py-1.5 text-[13px] text-[var(--color-foreground)] border border-[var(--color-hairline)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--color-brand)]/40"
          >
            Start ny samtale
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-[var(--radius-xl)] border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Kunne ikke gemme feedback</p>
            <p className="mt-0.5 text-[13px]">{state.message}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-red-700/70 hover:text-red-700"
            aria-label="Luk"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const submitting =
    state.phase === "submitting" ||
    (state.phase === "answered_yes" && state.submitting);

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium text-[var(--color-foreground)]">
            Var dette nyttigt?
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">
            Hjælp den næste operatør ved at fortælle os om svaret løste dit
            problem.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          disabled={submitting}
          className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-50"
          aria-label="Luk"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {state.phase === "prompt" || state.phase === "submitting" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onAnswerYes}
            disabled={submitting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-[14px] font-medium text-white shadow-[var(--shadow-sm)]",
              "transition-colors hover:bg-emerald-700 disabled:opacity-60",
            )}
          >
            <ThumbsUp className="h-4 w-4" />
            Ja, det løste det
          </button>
          <button
            type="button"
            onClick={onAnswerNo}
            disabled={submitting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface)] px-4 py-2 text-[14px] font-medium text-[var(--color-foreground)]",
              "border border-[var(--color-hairline)] shadow-[var(--shadow-sm)] transition-colors",
              "hover:border-[var(--color-brand)]/40 disabled:opacity-60",
            )}
          >
            <ThumbsDown className="h-4 w-4" />
            Nej
          </button>
          {submitting && (
            <Loader2 className="ml-1 mt-2 h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
          )}
        </div>
      ) : state.phase === "answered_yes" ? (
        <YesSolutionForm
          solution={state.solution}
          submitting={submitting}
          onChange={onSolutionChange}
          onSubmit={() => onSubmitYes(state.solution)}
          onSkip={() => onSubmitYes("")}
        />
      ) : null}
    </div>
  );
}

function YesSolutionForm({
  solution,
  submitting,
  onChange,
  onSubmit,
  onSkip,
}: {
  solution: string;
  submitting: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <label
        htmlFor="solution"
        className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]"
      >
        Hvad virkede? (valgfrit — bliver delt med næste operatør)
      </label>
      <Textarea
        id="solution"
        value={solution}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        disabled={submitting}
        placeholder="F.eks. RESET-knappen + genstart styringen efter alarm-koden var læst."
        className="min-h-[80px] text-[14px]"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={submitting}
          className="rounded-full bg-[var(--color-surface)] px-4 py-2 text-[13px] text-[var(--color-muted-foreground)] border border-[var(--color-hairline)] shadow-[var(--shadow-sm)] transition-colors hover:text-[var(--color-foreground)] disabled:opacity-60"
        >
          Spring over
        </button>
        <Button
          onClick={onSubmit}
          disabled={submitting}
          className="h-9 min-w-[90px] rounded-full bg-emerald-600 text-white shadow-[var(--shadow-sm)] hover:bg-emerald-700"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
        </Button>
      </div>
    </div>
  );
}

function EscalateCard({
  state,
  onSubmit,
  onNoteChange,
  onCancel,
  onStartNew,
}: {
  state: EscalateState;
  onSubmit: (note: string) => void;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onStartNew: () => void;
}) {
  if (state.phase === "done") {
    return (
      <div className="rounded-[var(--radius-xl)] border border-amber-200 bg-amber-50 p-4 shadow-[var(--shadow-md)]">
        <div className="flex items-start gap-3">
          <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
          <div className="flex-1">
            <p className="text-[15px] font-medium text-amber-900">
              Service tilkaldt
            </p>
            <p className="mt-0.5 text-[13px] text-amber-900/80">
              {state.channel === "phone"
                ? `Vi åbner telefonopkald til ${state.label ?? state.target}.`
                : state.channel === "email"
                  ? `E-mail sendt til ${state.label ?? state.target} med et link til samtalen.`
                  : state.channel === "webhook"
                    ? `Service-systemet har modtaget anmodningen${state.label ? ` (${state.label})` : ""}.`
                    : "Send linket nedenfor til service-teamet."}
            </p>
            {state.channel === "service_ticket" && (
              <ShareLinkRow url={state.shareUrl} />
            )}
          </div>
          <button
            type="button"
            onClick={onStartNew}
            className="rounded-full bg-[var(--color-surface)] px-3.5 py-1.5 text-[13px] text-[var(--color-foreground)] border border-[var(--color-hairline)] shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--color-brand)]/40"
          >
            Start ny samtale
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-[var(--radius-xl)] border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Kunne ikke tilkalde service</p>
            <p className="mt-0.5 text-[13px]">{state.message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-red-700/70 hover:text-red-700"
            aria-label="Luk"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (state.phase !== "confirm" && state.phase !== "submitting") return null;
  const submitting = state.phase === "submitting";
  const note = state.note;

  return (
    <div className="rounded-[var(--radius-xl)] border border-amber-200 bg-amber-50/60 p-4 shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium text-amber-900">
            Tilkald en tekniker?
          </p>
          <p className="mt-0.5 text-[13px] text-amber-900/80">
            Vi sender et midlertidigt link til samtalen til service-kontakten
            for din maskine. Tilføj gerne en kort beskrivelse.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-amber-900/60 hover:text-amber-900 disabled:opacity-50"
          aria-label="Annullér"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <Textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          rows={2}
          disabled={submitting}
          placeholder="F.eks. Maskinen alarmerer 731 og starter ikke efter genstart."
          className="min-h-[64px] text-[14px]"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-full bg-[var(--color-surface)] px-4 py-2 text-[13px] text-[var(--color-muted-foreground)] border border-[var(--color-hairline)] shadow-[var(--shadow-sm)] transition-colors hover:text-[var(--color-foreground)] disabled:opacity-60"
          >
            Annullér
          </button>
          <Button
            onClick={() => onSubmit(note)}
            disabled={submitting}
            className="h-9 min-w-[140px] rounded-full bg-amber-600 text-white shadow-[var(--shadow-sm)] hover:bg-amber-700"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="h-4 w-4" />
                Tilkald service
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ShareLinkRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on insecure contexts; the input below
      // still lets the operator select-and-copy manually.
    }
  }
  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 truncate rounded-[var(--radius)] border border-amber-200 bg-white px-3 py-1.5 text-[12px] text-amber-900"
      />
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-amber-200 bg-white px-3 py-1.5 text-[13px] text-amber-900 hover:bg-amber-100"
      >
        {copied ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Kopieret
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            Kopiér
          </>
        )}
      </button>
    </div>
  );
}
