"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
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
interface Message {
  role: Role;
  content: string;
}

const SAMPLE_QUESTIONS = [
  "Hvordan fjerner jeg alarm 731?",
  "Vis mig værktøjsskift-proceduren",
  "Hvad står der på vedligeholdelses-tjeklisten?",
];

export default function Home() {
  const {
    user,
    isInitializing,
    currentAccount,
    accountsForbidden,
    currentMachine,
    machinesForbidden,
  } = useAuth();
  useDeepLinkSelection();

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

  return <ChatApp />;
}

function ChatApp() {
  const { currentAccount, currentMachine } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // Server creates a conversations row on the first request and streams
  // its id back. We thread it on subsequent requests so all turns end up
  // grouped together for the audit view. Reset whenever the operator
  // switches machines so the new chat starts a fresh row.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const pendingRef = useRef("");
  const streamDoneRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Switching machine = new conversation context. Drop any prior id
    // and clear messages — operator likely wants a fresh slate.
    setConversationId(null);
    setMessages([]);
  }, [currentMachine?.id]);

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
    };
  }, []);

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

    try {
      const res = await fetchWithAuth("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: currentAccount?.id ?? null,
          machineId: currentMachine?.id ?? null,
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
    } finally {
      streamDoneRef.current = true;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isEmpty = messages.length === 0;
  const canSend = !streaming && input.trim().length > 0;

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
        <div className="mx-auto max-w-3xl px-6 pt-12 pb-44">
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
        <div
          aria-hidden
          className="pointer-events-none h-28 w-full"
          style={{
            background:
              "linear-gradient(to top, var(--color-background) 35%, oklch(from var(--color-background) l c h / 0%) 100%)",
          }}
        />
        <div className="pointer-events-auto mx-auto -mt-4 max-w-3xl px-4 pb-8">
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
          <div
            className={cn(
              "flex items-end gap-3 rounded-[var(--radius-xl)] bg-[var(--color-surface)] p-2.5",
              "border border-[var(--color-hairline)] shadow-[var(--shadow-lg)]",
              "transition-[border-color,box-shadow] duration-300",
              "focus-within:border-[var(--color-brand)]/30",
            )}
          >
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Skriv dit spørgsmål her…"
              rows={1}
              disabled={streaming}
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
    <div className="msg-in">
      <Markdown>{message.content}</Markdown>
    </div>
  );
}
