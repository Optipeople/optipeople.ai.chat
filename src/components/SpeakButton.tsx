"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Volume2, VolumeX } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { fetchWithAuth } from "@/auth/authApi";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

type Props = {
  text: string;
  className?: string;
};

// Per-message TTS playback. Lazily fetches /api/voice/speak on first
// click, caches the resulting blob URL for replays, and toggles
// play/pause on subsequent clicks. One <audio> element per button
// instance — no global player state — so two messages playing at once
// just don't happen because the user can only click one button.
export function SpeakButton({ text, className }: Props) {
  const t = useTranslations("speakButton");
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function handleClick() {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }

    if (audioRef.current && urlRef.current) {
      try {
        await audioRef.current.play();
        setState("playing");
      } catch {
        setState("error");
      }
      return;
    }

    setState("loading");
    try {
      const res = await fetchWithAuth("/api/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`Speech failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => setState("idle");
      audio.onpause = () => {
        if (!audio.ended) setState("idle");
      };
      audioRef.current = audio;
      await audio.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  const label =
    state === "playing"
      ? t("stop")
      : state === "loading"
        ? t("loading")
        : state === "error"
          ? t("error")
          : t("play");

  return (
    <Tooltip content={label} side="top">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "loading"}
        aria-label={label}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] disabled:opacity-60",
          state === "playing" && "text-[var(--ds-blue-primary)]",
          state === "error" && "text-[var(--ds-red)]",
          className,
        )}
      >
        {state === "loading" ? (
          <Spinner className="h-4 w-4" />
        ) : state === "playing" ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </button>
    </Tooltip>
  );
}
