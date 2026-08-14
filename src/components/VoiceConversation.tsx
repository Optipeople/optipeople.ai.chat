"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, AudioLines, Mic, MicOff } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  useRealtimeVoice,
  type RealtimeTranscriptTurn,
} from "@/lib/useRealtimeVoice";
import { Button } from "@/components/ui/button";
import { SourceChips } from "@/components/SourceChips";
import { useFocusTrap } from "@/lib/useFocusTrap";
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
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const { state, transcript, muted, start, stop, toggleMute } =
    useRealtimeVoice({
      machineId,
      accountId,
      onError: (msg) => {
        console.error("Voice conversation error:", msg);
        setErrorDetail(msg);
      },
    });

  // Auto-start the session on mount. The hook guards against
  // double-starts so React strict mode's double-invoke is safe.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") void handleEnd();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnd() {
    await stop();
    onClose();
  }

  function retry() {
    setErrorDetail(null);
    void start();
  }

  // The mic-permission failure gets an actionable hint; anything else
  // shows the generic body. Raw hook messages stay in the console.
  const isMicDenied =
    !!errorDetail && /permission|notallowed|denied/i.test(errorDetail);

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
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-background)]"
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {transcript.length === 0 && state !== "connecting" ? (
            <p className="text-center text-[15px] text-[var(--color-muted-foreground)]">
              {t("sayPrompt")}
            </p>
          ) : null}
          {state === "connecting" ? (
            <div className="flex items-center justify-center gap-2 text-[15px] text-[var(--color-muted-foreground)]">
              <Spinner className="h-4 w-4" />
              {t("connectingHint")}
            </div>
          ) : null}
          {transcript.map((turn) => (
            <TranscriptBubble key={turn.id} turn={turn} />
          ))}
          {state === "error" && (
            <div className="flex flex-col items-center gap-3 rounded-[6px] border border-[var(--color-amber)]/40 bg-[var(--color-amber-soft)] p-4 text-center">
              <AlertTriangle
                className="h-5 w-5 text-[var(--color-amber)]"
                aria-hidden
              />
              <p className="text-[14px] text-[var(--color-foreground)]">
                {isMicDenied ? t("errorMicDenied") : t("errorBody")}
              </p>
              {!isMicDenied && (
                <Button variant="secondary" size="sm" onClick={retry}>
                  {t("retry")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center px-4 pb-3 sm:px-6 sm:pb-4">
        <VoiceStatusPill state={state} muted={muted} label={statusLabel} />
      </div>

      <footer className="border-t border-[var(--color-border)] px-3 py-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:px-6 sm:py-6">
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-2 sm:gap-3">
          <Button
            variant={muted ? "destructive" : "secondary"}
            size="lg"
            className="flex-1 gap-2 px-3 sm:flex-none sm:px-8"
            onClick={toggleMute}
            disabled={state !== "active"}
            aria-label={muted ? t("muteOn") : t("muteOff")}
          >
            {muted ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            <span className="truncate">{muted ? t("muteOn") : t("muteOff")}</span>
          </Button>
          <Button
            variant="destructive"
            size="lg"
            className="flex-1 gap-2 px-3 sm:flex-none sm:px-8"
            onClick={handleEnd}
            aria-label={t("end")}
          >
            <AudioLines className="h-5 w-5" />
            <span className="truncate">{t("end")}</span>
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
          "max-w-[90%] rounded-[8px] px-3 py-2.5 text-[15px] leading-[1.5] whitespace-pre-wrap break-words sm:max-w-[80%] sm:px-4 sm:py-3 sm:text-[16px]",
          isUser
            ? "bg-[var(--color-accent)] text-[var(--color-primary-foreground)]"
            : "bg-[var(--color-muted)] text-[var(--color-foreground)]",
          !turn.final && "opacity-80",
        )}
      >
        {turn.text || (turn.final ? "" : "…")}
      </div>
      {sources && sources.length > 0 && (
        <div className="max-w-[90%] sm:max-w-[80%]">
          <SourceChips sources={sources} />
        </div>
      )}
    </div>
  );
}
