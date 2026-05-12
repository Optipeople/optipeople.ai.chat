"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/auth/authApi";
import type { SourceRef } from "@/components/SourceChips";

// State machine for the conversation lifecycle. The UI maps these to
// labels + icons; nothing else depends on them.
export type RealtimeState =
  | "idle"
  | "connecting"
  | "active"
  | "ending"
  | "error";

export type RealtimeTranscriptTurn =
  | { id: string; role: "user"; text: string; final: boolean }
  | {
      id: string;
      role: "assistant";
      text: string;
      final: boolean;
      sources?: SourceRef[];
    };

type Options = {
  machineId: string;
  accountId: string;
  onError?: (message: string) => void;
};

// One turn the server-side persist endpoint will accept. Mirror of the
// shape declared in /api/voice/realtime/persist/route.ts so we don't
// have to import server types into the client bundle.
type PersistTurn =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: { name: string; input: unknown }[];
    }
  | {
      role: "tool";
      toolName: string;
      toolInput: unknown;
      toolChunks?: string[];
      contentSummary: string;
    };

type SessionInfo = {
  sessionId: string;
  clientSecret: string;
  expiresAt: number;
  model: string;
  machineId: string;
  accountId: string;
};

// Build the WebRTC connection to OpenAI Realtime, run the session, and
// expose live transcript + state to the UI. Audio plays automatically
// through a hidden <audio> element this hook owns. cleanup() is always
// safe to call.
export function useRealtimeVoice({ machineId, accountId, onError }: Options) {
  const [state, setState] = useState<RealtimeState>("idle");
  const [transcript, setTranscript] = useState<RealtimeTranscriptTurn[]>([]);
  const [muted, setMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const turnsRef = useRef<PersistTurn[]>([]);
  // Tracks pending assistant text per response_id so streaming deltas
  // accumulate into a single transcript turn.
  const assistantBufRef = useRef<Map<string, string>>(new Map());
  // Best document hit per document_id, accumulated from search_kb tool
  // returns. Flushed onto the next assistant turn when it begins
  // streaming, so the model's spoken reply gets the right citations.
  const pendingSourcesRef = useRef<Map<string, SourceRef & { score: number }>>(
    new Map(),
  );
  // Response IDs that have already had pending sources attached. Lets us
  // do the snapshot+clear safely outside setTranscript (whose callback
  // may run twice under React strict mode).
  const sourcedResponsesRef = useRef<Set<string>>(new Set());

  const handleError = useCallback(
    (msg: string) => {
      console.error("realtime:", msg);
      setState("error");
      onError?.(msg);
    },
    [onError],
  );

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify(event));
  }, []);

  const handleToolCall = useCallback(
    async (callId: string, name: string, argsRaw: string) => {
      let args: Record<string, unknown> = {};
      try {
        args = argsRaw ? (JSON.parse(argsRaw) as Record<string, unknown>) : {};
      } catch {
        // Send back a structured error so the model can recover
        // gracefully — better than silently stalling the response.
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ error: "Invalid JSON arguments" }),
          },
        });
        sendEvent({ type: "response.create" });
        return;
      }

      try {
        const res = await fetchWithAuth("/api/voice/realtime/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            arguments: args,
            machineId: sessionRef.current?.machineId ?? machineId,
          }),
        });
        const data = (await res.json()) as {
          output?: unknown;
          chunkIds?: string[];
          error?: string;
        };
        const output = data.output ?? { error: data.error ?? "Tool failed" };

        // Extract source chips from search_kb results. Keep the
        // highest-scoring chunk per document so the chip deep-links to
        // the most relevant page.
        if (name === "search_kb" && output && typeof output === "object") {
          const results = (output as { results?: unknown }).results;
          if (Array.isArray(results)) {
            for (const r of results as Array<{
              document_id?: string;
              title?: string;
              page_from?: number | null;
              score?: number;
            }>) {
              if (!r.document_id || !r.title) continue;
              const score = typeof r.score === "number" ? r.score : 0;
              const existing = pendingSourcesRef.current.get(r.document_id);
              if (!existing || score > existing.score) {
                pendingSourcesRef.current.set(r.document_id, {
                  id: r.document_id,
                  title: r.title,
                  pageFrom: r.page_from ?? null,
                  score,
                });
              }
            }
          }
        }

        // Persist the tool turn locally so the post-session writeback
        // captures it. Bound the JSON snapshot so a giant search payload
        // doesn't blow past the messages.content column.
        const summary = JSON.stringify(output);
        turnsRef.current.push({
          role: "tool",
          toolName: name,
          toolInput: args,
          toolChunks: data.chunkIds,
          contentSummary:
            summary.length > 4000 ? summary.slice(0, 4000) + "…[truncated]" : summary,
        });

        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(output),
          },
        });
        sendEvent({ type: "response.create" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Tool error";
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify({ error: msg }),
          },
        });
        sendEvent({ type: "response.create" });
      }
    },
    [machineId, sendEvent],
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

      // A new conversation item was created on the server. We use this
      // to insert the user's bubble in the correct chronological
      // position — input audio transcription completes asynchronously
      // and can arrive AFTER the assistant has already started speaking,
      // so relying on the transcription event for ordering produces a
      // reversed transcript.
      if (type === "conversation.item.created") {
        const item = evt.item as
          | {
              id?: string;
              role?: string;
              type?: string;
              content?: Array<{ type?: string; transcript?: string }>;
            }
          | undefined;
        if (item?.role === "user" && item.type === "message" && item.id) {
          const existingTranscript =
            item.content?.find((c) => c?.type === "input_audio")?.transcript ??
            "";
          setTranscript((prev) => {
            if (prev.some((t) => t.id === item.id)) return prev;
            return [
              ...prev,
              {
                id: item.id!,
                role: "user",
                text: existingTranscript,
                final: !!existingTranscript,
              },
            ];
          });
        }
        return;
      }

      // User speech transcript — fired once per completed input audio
      // item by the server-side transcription pass. Fills the
      // placeholder turn we created at conversation.item.created.
      if (type === "conversation.item.input_audio_transcription.completed") {
        const itemId = (evt.item_id as string) ?? crypto.randomUUID();
        const text = ((evt.transcript as string) ?? "").trim();
        if (!text) return;
        turnsRef.current.push({ role: "user", content: text });
        setTranscript((prev) => {
          const idx = prev.findIndex((t) => t.id === itemId);
          if (idx === -1) {
            return [
              ...prev,
              { id: itemId, role: "user", text, final: true },
            ];
          }
          const copy = prev.slice();
          copy[idx] = { ...copy[idx], role: "user", text, final: true };
          return copy;
        });
        return;
      }

      // Assistant audio transcript streams in chunks. Accumulate per
      // response_id so the UI shows a live "typing" text alongside the
      // spoken audio.
      if (type === "response.audio_transcript.delta") {
        const responseId = (evt.response_id as string) ?? "current";
        const delta = (evt.delta as string) ?? "";
        const current = assistantBufRef.current.get(responseId) ?? "";
        const next = current + delta;
        assistantBufRef.current.set(responseId, next);

        // Snapshot+clear pending sources exactly once per response, out
        // here in the event handler — not inside setTranscript, which
        // strict mode can call twice.
        let sourcesToAttach: SourceRef[] | undefined;
        if (!sourcedResponsesRef.current.has(responseId)) {
          sourcedResponsesRef.current.add(responseId);
          if (pendingSourcesRef.current.size > 0) {
            sourcesToAttach = Array.from(pendingSourcesRef.current.values())
              .sort((a, b) => b.score - a.score)
              .map(({ id, title, pageFrom }) => ({ id, title, pageFrom }));
            pendingSourcesRef.current.clear();
          }
        }

        setTranscript((prev) => {
          const idx = prev.findIndex(
            (t) => t.role === "assistant" && t.id === responseId,
          );
          if (idx === -1) {
            return [
              ...prev,
              {
                id: responseId,
                role: "assistant",
                text: next,
                final: false,
                ...(sourcesToAttach && sourcesToAttach.length > 0
                  ? { sources: sourcesToAttach }
                  : {}),
              },
            ];
          }
          const copy = prev.slice();
          const existing = copy[idx];
          copy[idx] =
            existing.role === "assistant"
              ? {
                  ...existing,
                  text: next,
                  // Late-arriving sources (e.g. a search_kb call that
                  // returned after the first delta) — merge them in
                  // rather than overwrite.
                  ...(sourcesToAttach && sourcesToAttach.length > 0
                    ? {
                        sources: [
                          ...(existing.sources ?? []),
                          ...sourcesToAttach,
                        ],
                      }
                    : {}),
                }
              : { ...existing, text: next };
          return copy;
        });
        return;
      }

      if (type === "response.audio_transcript.done") {
        const responseId = (evt.response_id as string) ?? "current";
        const finalText =
          ((evt.transcript as string) ?? assistantBufRef.current.get(responseId) ?? "").trim();
        if (finalText) {
          turnsRef.current.push({ role: "assistant", content: finalText });
        }
        assistantBufRef.current.delete(responseId);
        setTranscript((prev) =>
          prev.map((t) =>
            t.role === "assistant" && t.id === responseId
              ? { ...t, text: finalText, final: true }
              : t,
          ),
        );
        return;
      }

      // Tool/function call. The model emits arguments token-by-token
      // and finishes with `.done` carrying the full JSON string.
      if (type === "response.function_call_arguments.done") {
        const callId = evt.call_id as string;
        const name = evt.name as string;
        const argsRaw = (evt.arguments as string) ?? "";
        if (callId && name) void handleToolCall(callId, name, argsRaw);
        return;
      }

      if (type === "error") {
        const errPayload = evt.error as { message?: string } | undefined;
        handleError(errPayload?.message ?? "Realtime error");
        return;
      }
    },
    [handleError, handleToolCall],
  );

  const cleanup = useCallback(() => {
    try {
      dcRef.current?.close();
    } catch {}
    try {
      pcRef.current?.close();
    } catch {}
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }
    dcRef.current = null;
    pcRef.current = null;
    micStreamRef.current = null;
    assistantBufRef.current.clear();
    pendingSourcesRef.current.clear();
    sourcedResponsesRef.current.clear();
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async () => {
    if (state === "connecting" || state === "active") return;
    setState("connecting");
    setTranscript([]);
    turnsRef.current = [];

    let session: SessionInfo;
    try {
      const res = await fetchWithAuth("/api/voice/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, accountId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Session failed (${res.status})`);
      }
      session = (await res.json()) as SessionInfo;
      sessionRef.current = session;
    } catch (err) {
      handleError(err instanceof Error ? err.message : "Session failed");
      return;
    }

    let micStream: MediaStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      handleError("permissionDenied");
      return;
    }
    micStreamRef.current = micStream;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    // Hidden audio sink for the model's voice. We attach the remote
    // track directly; the browser handles playback.
    if (!audioElRef.current) {
      const el = document.createElement("audio");
      el.autoplay = true;
      audioElRef.current = el;
    }
    pc.ontrack = (e) => {
      if (audioElRef.current) audioElRef.current.srcObject = e.streams[0];
    };

    micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = handleEvent;
    dc.onopen = () => setState("active");
    dc.onclose = () => {
      // Don't downgrade an explicit error state.
      setState((prev) => (prev === "error" ? prev : "idle"));
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        handleError("connectionLost");
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.clientSecret}`,
            "Content-Type": "application/sdp",
            "OpenAI-Beta": "realtime=v1",
          },
          body: offer.sdp ?? "",
        },
      );
      if (!sdpRes.ok) {
        throw new Error(`SDP exchange failed (${sdpRes.status})`);
      }
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (err) {
      handleError(err instanceof Error ? err.message : "Connection failed");
      cleanup();
    }
  }, [accountId, cleanup, handleError, handleEvent, machineId, state]);

  const stop = useCallback(async () => {
    if (state === "idle") return;
    setState("ending");
    const turns = turnsRef.current.slice();
    cleanup();
    setState("idle");

    // Best-effort persistence — losing the audit on a network blip is
    // not worth blocking the UI on.
    if (turns.length > 0) {
      try {
        await fetchWithAuth("/api/voice/realtime/persist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineId, accountId, turns }),
        });
      } catch (err) {
        console.warn("voice persist failed:", err);
      }
    }
  }, [accountId, cleanup, machineId, state]);

  const toggleMute = useCallback(() => {
    const stream = micStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  return { state, transcript, muted, start, stop, toggleMute };
}
