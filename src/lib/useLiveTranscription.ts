"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/auth/authApi";
import { waitForIceGathering } from "@/lib/waitForIceGathering";

export type LiveTranscriptionState =
  | "idle"
  | "connecting"
  | "listening"
  | "finalizing"
  | "error";

type Options = {
  // Fires on every change to the streamed transcript. `text` is the
  // accumulated final segments plus the in-flight partial, suitable to
  // drop straight into a textarea value.
  onChange: (text: string) => void;
  // Fires once when the session ends with the final transcript text.
  // May be empty if the user said nothing.
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
};

type SessionInfo = {
  sessionId: string;
  clientSecret: string;
  expiresAt: number;
};

// Streams microphone audio to OpenAI Realtime in transcription-only
// mode and surfaces partial + final transcript text as the user speaks.
// Uses WebRTC like the full realtime hook but skips the assistant audio
// sink, tools, and persistence — it's a Whisper-equivalent that streams.
export function useLiveTranscription({ onChange, onFinal, onError }: Options) {
  const [state, setState] = useState<LiveTranscriptionState>("idle");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Accumulated finalised segments, joined with a single space.
  const finalsRef = useRef<string[]>([]);
  // Latest partial transcript for the currently-spoken segment.
  const partialRef = useRef<string>("");
  // Most recent text we pushed via onChange — used to decide whether
  // to emit again so we don't spam the parent.
  const lastEmittedRef = useRef<string>("");
  // Set while stop() is waiting for the last utterance's `completed`
  // event; resolved by handleEvent so we don't cut off trailing words
  // with a fixed timer.
  const finalizeResolveRef = useRef<(() => void) | null>(null);

  const composed = useCallback(() => {
    const finals = finalsRef.current.join(" ").trim();
    const partial = partialRef.current.trim();
    if (finals && partial) return `${finals} ${partial}`;
    return finals || partial;
  }, []);

  const emit = useCallback(() => {
    const next = composed();
    if (next === lastEmittedRef.current) return;
    lastEmittedRef.current = next;
    onChange(next);
  }, [composed, onChange]);

  const cleanup = useCallback(() => {
    try {
      dcRef.current?.close();
    } catch {}
    try {
      pcRef.current?.close();
    } catch {}
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    micStreamRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleError = useCallback(
    (msg: string) => {
      console.error("live-transcribe:", msg);
      cleanup();
      setState("error");
      onError?.(msg);
    },
    [cleanup, onError],
  );

  const handleEvent = useCallback(
    (raw: MessageEvent<string>) => {
      let evt: { type?: string; [k: string]: unknown };
      try {
        evt = JSON.parse(raw.data);
      } catch {
        return;
      }
      const type = evt.type;
      if (!type) return;

      // Streamed partial transcript for the current utterance. Replace
      // the partial buffer — OpenAI sends cumulative deltas as the model
      // refines what it heard, not append-only diffs.
      if (type === "conversation.item.input_audio_transcription.delta") {
        const delta = (evt.delta as string) ?? "";
        // The delta event is append-only in the current API; concatenate.
        partialRef.current = partialRef.current + delta;
        emit();
        return;
      }

      if (type === "conversation.item.input_audio_transcription.completed") {
        const finalText = ((evt.transcript as string) ?? "").trim();
        partialRef.current = "";
        if (finalText) finalsRef.current.push(finalText);
        emit();
        // If stop() is waiting for this utterance to finalize, let it
        // proceed now instead of running its timeout down.
        finalizeResolveRef.current?.();
        return;
      }

      if (type === "error") {
        const errPayload = evt.error as { message?: string } | undefined;
        handleError(errPayload?.message ?? "transcriptionFailed");
      }
    },
    [emit, handleError],
  );

  const start = useCallback(async () => {
    if (state === "connecting" || state === "listening") return;
    finalsRef.current = [];
    partialRef.current = "";
    lastEmittedRef.current = "";
    setState("connecting");

    let session: SessionInfo;
    try {
      const res = await fetchWithAuth("/api/voice/transcribe-stream/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Session failed (${res.status})`);
      }
      session = (await res.json()) as SessionInfo;
    } catch (err) {
      handleError(err instanceof Error ? err.message : "transcriptionFailed");
      return;
    }

    // Insecure contexts and old WebViews have no mediaDevices at all —
    // that's "unsupported", not a denied permission.
    if (!navigator.mediaDevices?.getUserMedia) {
      handleError("unsupported");
      return;
    }
    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      handleError(
        name === "NotAllowedError" || name === "PermissionDeniedError" ||
          name === "SecurityError"
          ? "permissionDenied"
          : "unsupported",
      );
      return;
    }
    micStreamRef.current = micStream;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    // Transcription-only sessions don't send remote audio back, but we
    // still have to negotiate a recvonly direction so the SDP answer is
    // valid. Adding the mic track does that implicitly.
    micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = handleEvent;
    dc.onopen = () => setState("listening");
    dc.onclose = () => {
      setState((prev) => (prev === "error" ? prev : "idle"));
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") handleError("connectionLost");
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      // GA Realtime API: the SDP offer is exchanged at /v1/realtime/calls
      // and the `OpenAI-Beta` header is gone. The transcription session
      // config travels on the ephemeral key, so no query params here.
      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: pc.localDescription?.sdp ?? offer.sdp ?? "",
        },
      );
      if (!sdpRes.ok) {
        throw new Error(`SDP exchange failed (${sdpRes.status})`);
      }
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      handleError(err instanceof Error ? err.message : "connectionLost");
    }
  }, [handleError, handleEvent, state]);

  const stop = useCallback(async () => {
    if (state !== "listening" && state !== "connecting") return;
    setState("finalizing");

    // Wait for the server VAD to emit the final transcript for any
    // in-flight utterance before tearing down, so trailing words aren't
    // cut off. The `completed` event resolves us early; the timeout is
    // the fallback for a slow or missing final.
    if (partialRef.current.trim().length > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          finalizeResolveRef.current = null;
          resolve();
        }, 2000);
        finalizeResolveRef.current = () => {
          clearTimeout(timer);
          finalizeResolveRef.current = null;
          resolve();
        };
      });
    } else {
      // Nothing in flight — a short grace period still catches a final
      // that was about to land.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    cleanup();
    const finalText = composed();
    setState("idle");
    onFinal(finalText);
  }, [cleanup, composed, onFinal, state]);

  const cancel = useCallback(() => {
    cleanup();
    finalsRef.current = [];
    partialRef.current = "";
    lastEmittedRef.current = "";
    setState("idle");
  }, [cleanup]);

  return { state, start, stop, cancel };
}
