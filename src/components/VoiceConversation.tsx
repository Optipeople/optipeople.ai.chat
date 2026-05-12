"use client";

import { useEffect, useRef } from "react";
import { Loader2, Mic, MicOff, PhoneOff } from "lucide-react";
import {
  useRealtimeVoice,
  type RealtimeTranscriptTurn,
} from "@/lib/useRealtimeVoice";
import { cn } from "@/lib/utils";

type Props = {
  machineId: string;
  accountId: string;
  onClose: () => void;
};

// Full-screen voice conversation overlay. Owns the realtime session
// from open to close; never reused across mount cycles, so the hook
// state is naturally scoped to a single conversation.
export function VoiceConversation({ machineId, accountId, onClose }: Props) {
  const { state, transcript, muted, start, stop, toggleMute } =
    useRealtimeVoice({
      machineId,
      accountId,
      onError: (msg) => console.error("Voice conversation error:", msg),
    });

  // Auto-start the session on mount. The hook guards against
  // double-starts so React strict mode's double-invoke is safe.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start]);

  async function handleEnd() {
    await stop();
    onClose();
  }

  // Auto-scroll the transcript pane to the latest turn so the operator
  // can glance at what the model just said while it's still speaking.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const statusLabel =
    state === "connecting"
      ? "Forbinder…"
      : state === "active"
        ? muted
          ? "Mikrofon slået fra"
          : "Lytter…"
        : state === "ending"
          ? "Afslutter…"
          : state === "error"
            ? "Fejl — prøv igen"
            : "Inaktiv";

  return (
    <div
      role="dialog"
      aria-label="Stemme-samtale med OptiAI"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-background)]"
    >
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex h-3 w-3 rounded-full",
              state === "active" && !muted
                ? "bg-[var(--ds-green-primary,#16a34a)] animate-pulse"
                : state === "connecting"
                  ? "bg-[var(--color-muted-foreground)] animate-pulse"
                  : state === "error"
                    ? "bg-[var(--color-destructive)]"
                    : "bg-[var(--color-muted-foreground)]",
            )}
            aria-hidden
          />
          <div>
            <div className="text-[15px] font-semibold text-[var(--color-foreground)]">
              Stemme-samtale
            </div>
            <div className="text-[13px] text-[var(--color-muted-foreground)]">
              {statusLabel}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleEnd}
          className="inline-flex items-center gap-2 rounded-[4px] bg-[var(--color-destructive)] px-4 py-2 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <PhoneOff className="h-4 w-4" />
          Afslut
        </button>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-8"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {transcript.length === 0 && state !== "connecting" ? (
            <p className="text-center text-[15px] text-[var(--color-muted-foreground)]">
              Sig hvad du har brug for hjælp til.
            </p>
          ) : null}
          {state === "connecting" ? (
            <div className="flex items-center justify-center gap-2 text-[15px] text-[var(--color-muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Forbinder til OptiAI…
            </div>
          ) : null}
          {transcript.map((turn) => (
            <TranscriptBubble key={turn.id} turn={turn} />
          ))}
        </div>
      </div>

      <footer className="border-t border-[var(--color-border)] px-6 py-6">
        <div className="mx-auto flex max-w-2xl items-center justify-center">
          <button
            type="button"
            onClick={toggleMute}
            disabled={state !== "active"}
            aria-label={muted ? "Slå mikrofon til" : "Slå mikrofon fra"}
            className={cn(
              "inline-flex h-16 w-16 items-center justify-center rounded-full border transition-colors",
              "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)]",
              "hover:bg-[var(--color-muted)] disabled:opacity-50",
              muted && "border-transparent bg-[var(--color-destructive)] text-white",
            )}
          >
            {muted ? (
              <MicOff className="h-7 w-7" />
            ) : (
              <Mic className="h-7 w-7" />
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}

function TranscriptBubble({ turn }: { turn: RealtimeTranscriptTurn }) {
  const isUser = turn.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-[8px] px-4 py-3 text-[16px] leading-[1.5] whitespace-pre-wrap",
          isUser
            ? "bg-[var(--color-accent)] text-[var(--color-primary-foreground)]"
            : "bg-[var(--color-muted)] text-[var(--color-foreground)]",
          !turn.final && "opacity-80",
        )}
      >
        {turn.text || (turn.final ? "" : "…")}
      </div>
    </div>
  );
}
