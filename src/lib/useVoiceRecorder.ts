"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/auth/authApi";

export type VoiceRecorderState = "idle" | "recording" | "transcribing";

type Options = {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
};

// Push-to-record voice capture. start() begins MediaRecorder, stop()
// uploads the captured webm to /api/voice/transcribe and calls
// onTranscript with the result. The hook owns the stream so callers
// don't have to wire teardown — pageunload and a manual cancel() are
// both safe.
export function useVoiceRecorder({ onTranscript, onError }: Options) {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => releaseStream(), [releaseStream]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError?.("Mikrofon ikke understøttet i denne browser");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError?.("Adgang til mikrofon blev nægtet");
      return;
    }

    // Prefer webm/opus when available — it's what Chromium gives by
    // default and Whisper accepts it natively. Safari falls back to mp4.
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : undefined;

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
  }, [state, onError]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || state !== "recording") return;

    setState("transcribing");
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;

    const type = recorder.mimeType || "audio/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(chunksRef.current, { type });
    releaseStream();

    if (blob.size === 0) {
      setState("idle");
      onError?.("Optagelsen var tom");
      return;
    }

    try {
      const form = new FormData();
      form.append("audio", blob, `speech.${ext}`);
      const res = await fetchWithAuth("/api/voice/transcribe", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Transcription failed (${res.status})`);
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim();
      if (text) onTranscript(text);
      else onError?.("Ingen tale registreret");
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Transskription mislykkedes");
    } finally {
      setState("idle");
    }
  }, [state, releaseStream, onTranscript, onError]);

  const cancel = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    releaseStream();
    setState("idle");
  }, [releaseStream]);

  return { state, start, stop, cancel };
}
