"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AudioLines, Loader2, Mic, MicOff } from "lucide-react";
import {
  useRealtimeVoice,
  type RealtimeTranscriptTurn,
} from "@/lib/useRealtimeVoice";
import { Button } from "@/components/ui/button";
import { SourceChips } from "@/components/SourceChips";
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
  const t = useTranslations("voice");
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
      ? t("status.connecting")
      : state === "active"
        ? muted
          ? t("status.muted")
          : t("status.listening")
        : state === "ending"
          ? t("status.ending")
          : state === "error"
            ? t("status.error")
            : t("status.idle");

  return (
    <div
      role="dialog"
      aria-label={t("dialogLabel")}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-background)]"
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-8"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {transcript.length === 0 && state !== "connecting" ? (
            <p className="text-center text-[15px] text-[var(--color-muted-foreground)]">
              {t("sayPrompt")}
            </p>
          ) : null}
          {state === "connecting" ? (
            <div className="flex items-center justify-center gap-2 text-[15px] text-[var(--color-muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("connectingHint")}
            </div>
          ) : null}
          {transcript.map((turn) => (
            <TranscriptBubble key={turn.id} turn={turn} />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center px-6 pb-4">
        <VoiceStatusPill state={state} muted={muted} label={statusLabel} />
      </div>

      <footer className="border-t border-[var(--color-border)] px-6 py-6">
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-3">
          <Button
            variant={muted ? "destructive" : "secondary"}
            size="lg"
            className="gap-2"
            onClick={toggleMute}
            disabled={state !== "active"}
            aria-label={muted ? t("muteOn") : t("muteOff")}
          >
            {muted ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            {muted ? t("muteOn") : t("muteOff")}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            className="gap-2"
            onClick={handleEnd}
            aria-label={t("end")}
          >
            <AudioLines className="h-5 w-5" />
            {t("end")}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function VoiceStatusPill({
  state,
  muted,
  label,
}: {
  state: ReturnType<typeof useRealtimeVoice>["state"];
  muted: boolean;
  label: string;
}) {
  const isListening = state === "active" && !muted;
  const isConnecting = state === "connecting";
  const isError = state === "error";

  const tone = isListening
    ? "text-[var(--ds-green-primary,#16a34a)]"
    : isError
      ? "text-[var(--color-destructive)]"
      : "text-[var(--color-muted-foreground)]";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card,var(--color-background))] py-2 pl-3 pr-4 backdrop-blur",
        isListening && "voice-pill-active border-[var(--ds-green-primary,#16a34a)]/40",
      )}
      role="status"
      aria-live="polite"
    >
      <span className={cn("voice-eq", (isListening || isConnecting) && "is-active", tone)} aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className="text-[13px] font-medium text-[var(--color-foreground)]">
        {label}
      </span>
    </div>
  );
}

function TranscriptBubble({ turn }: { turn: RealtimeTranscriptTurn }) {
  const isUser = turn.role === "user";
  const sources = !isUser ? turn.sources : undefined;
  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
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
      {sources && sources.length > 0 && (
        <div className="max-w-[80%]">
          <SourceChips sources={sources} />
        </div>
      )}
    </div>
  );
}
