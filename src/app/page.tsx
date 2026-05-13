"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Mic,
  AudioLines,
  Plus,
  Square,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react";
import type { EscalateResponse } from "@/app/api/chat/escalate/route";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FieldFrame } from "@/components/ui/field";
import { Markdown } from "@/components/ui/markdown";
import { AppHeader } from "@/components/AppHeader";
import { LoginScreen } from "@/components/LoginScreen";
import { AccountSelectScreen } from "@/components/AccountSelectScreen";
import { MachineSelectScreen } from "@/components/MachineSelectScreen";
import { KnowledgeDrawer } from "@/components/KnowledgeDrawer";
import { SpeakButton } from "@/components/SpeakButton";
import { VoiceConversation } from "@/components/VoiceConversation";
import { SourceChips, type SourceRef } from "@/components/SourceChips";
import { useLiveTranscription } from "@/lib/useLiveTranscription";
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
      // Capturing browser-only URL params on mount — has to run after
      // hydration, can't be derived inline at render time.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // Synchronising local "pending deep-link" intent with auth-context
      // state — the effect IS the synchronisation, can't be hoisted.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
// One image-caption hit. The chat client resolves assetId → signed URL
// on demand via /api/assets/<assetId>/url. For PDF-figure assets the
// signed URL is the parent PDF — combined with pageFrom we deep-link
// rather than render inline.
type ImageSourceRef = {
  assetId: string;
  documentId: string;
  documentTitle: string;
  altText: string;
  pageFrom: number | null;
  mimeType: string;
};
// User-uploaded image attached to a message. The id refers to a
// conversation_attachments row; previewUrl is an object URL we hold for
// instant rendering after upload. Once the message is fully sent we
// could swap to a signed URL via /api/chat/attachments/[id]/url, but
// the object URL stays valid for the session so we just keep using it.
type ChatAttachment = {
  id: string;
  previewUrl: string;
  mimeType: string;
};

// What the server tells us about a tool currently being invoked.
// `source: "mcp"` flags Anthropic-handled MCP tools (which we don't
// run ourselves); everything else is one of our custom tools
// (currently just search_kb). Used to render the in-stream
// "Searching the manuals…" / "Fetching machine data…" indicator.
type ActiveTool = {
  name: string;
  source?: "mcp";
  serverName?: string;
};

interface Message {
  role: Role;
  content: string;
  sources?: SourceRef[];
  images?: ImageSourceRef[];
  attachments?: ChatAttachment[];
  // Only ever set on the currently-streaming assistant message;
  // cleared by the next tool_result (MCP path) or when the stream
  // ends. We deliberately only track the most recent one — the chat
  // never fires enough tools in parallel for that to feel lossy.
  activeTool?: ActiveTool;
}

// Local-only state for an attachment the operator is in the middle of
// uploading. Once `status === "ready"`, the id is filled in and the
// pending entry is promoted to a real ChatAttachment when send() fires.
type PendingAttachment = {
  // Stable client id for the React list and removal handler.
  localId: string;
  previewUrl: string;
  file: File;
  status: "uploading" | "ready" | "error";
  // Set when status === "ready".
  id?: string;
  errorMessage?: string;
};

const MAX_ATTACHMENTS = 4;
const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp";
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

type ChatTarget = {
  account: { id: string; name: string };
  machine: { id: string; name: string };
};

export default function Home() {
  const tQrError = useTranslations("qrError");
  const tCommon = useTranslations("common");
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
      // Initial QR phase decided once on mount based on sessionStorage —
      // requires the post-hydration window to read.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
              ? tQrError("invalid")
              : tQrError("lookupFailed", { status: res.status }),
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
          message: err instanceof Error ? err.message : tCommon("unknownError"),
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
  const t = useTranslations("qrError");
  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-background)] p-6">
      <div className="max-w-md rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-[16px] font-medium text-red-800">{t("heading")}</p>
        <p className="mt-2 text-[14px] text-red-700">{message}</p>
        <p className="mt-4 text-[12px] text-red-700/80">
          {t("askAdmin")}
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
// move to submitting, then land on `done` — for SMS/email/webhook the
// server has already delivered to the tech; for service_ticket the
// done view exposes the share URL for copy.
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

// Fisher-Yates shuffle, returns up to `n` unique items from `items`.
// Used to pick the visible suggestion chips out of a larger candidate
// pool, and to pick the replacement when a chip rotates.
function pickRandom<T>(items: T[], n: number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

function ChatApp({
  account,
  machine,
}: {
  account: { id: string; name: string } | null;
  machine: { id: string; name: string } | null;
}) {
  const tChat = useTranslations("chat");
  // Shown when the machine's KB is empty (or the suggestions fetch fails).
  // Intentionally broad so they make sense even without manual content.
  const FALLBACK_QUESTIONS = [
    tChat("fallbackQuestions.q1"),
    tChat("fallbackQuestions.q2"),
    tChat("fallbackQuestions.q3"),
  ];
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
  // Pool of candidate starter questions for this machine, fetched once.
  // `visibleSuggestions` is the 3 currently rendered as chips; the rotation
  // effect below swaps one of them out every few seconds so the empty
  // state feels alive without re-hitting the server.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [visibleSuggestions, setVisibleSuggestions] = useState<string[]>([]);
  // Bumped per-chip when that slot is swapped — used in the React key so
  // the chip remounts and replays its entrance animation.
  const [chipVersions, setChipVersions] = useState<number[]>([0, 0, 0]);
  const visibleSuggestionsRef = useRef<string[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pendingRef = useRef("");
  const streamDoneRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceConvOpen, setVoiceConvOpen] = useState(false);
  const tVoiceErrors = useTranslations("server.voiceErrors");
  // Whatever the user had typed before they hit record. The live
  // transcript is appended onto this so already-typed text isn't lost.
  const voicePrefixRef = useRef("");
  const liveTranscribe = useLiveTranscription({
    onChange: (text) => {
      const prefix = voicePrefixRef.current;
      setInput(prefix ? `${prefix} ${text}` : text);
    },
    onFinal: (text) => {
      const prefix = voicePrefixRef.current;
      const merged = prefix ? `${prefix} ${text}`.trim() : text.trim();
      setInput(merged);
      setVoiceError(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    onError: (message) => {
      const known = [
        "permissionDenied",
        "unsupported",
        "emptyRecording",
        "noSpeech",
        "transcriptionFailed",
        "connectionLost",
      ];
      setVoiceError(known.includes(message) ? tVoiceErrors(message) : message);
    },
  });

  // The recorder button JSX was written against a tri-state shape
  // (idle/recording/transcribing). Map the richer live-transcription
  // states onto it so the surrounding markup stays untouched.
  const voiceState: "idle" | "recording" | "transcribing" =
    liveTranscribe.state === "listening" || liveTranscribe.state === "connecting"
      ? "recording"
      : liveTranscribe.state === "finalizing"
        ? "transcribing"
        : "idle";
  const startVoice = useCallback(() => {
    voicePrefixRef.current = input.trim();
    void liveTranscribe.start();
  }, [input, liveTranscribe]);
  const stopVoice = useCallback(() => {
    void liveTranscribe.stop();
  }, [liveTranscribe]);
  useEffect(() => {
    // Switching machine = new conversation context. Drop any prior id
    // and clear messages — operator likely wants a fresh slate. This
    // synchronises several local state slots with the externally-owned
    // machine selection; key-based remount would be a heavier refactor.
    /* eslint-disable react-hooks/set-state-in-effect */
    setConversationId(null);
    setMessages([]);
    setFeedback({ phase: "hidden" });
    setEscalate({ phase: "hidden" });
    setSuggestions([]);
    setVisibleSuggestions([]);
    setChipVersions([0, 0, 0]);
    setPendingAttachments((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
    setAttachmentError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [machine?.id]);

  // Per-machine starter questions live on machine_kb and are regenerated
  // on KB changes (ingest / reset / delete). We fetch the full candidate
  // pool and immediately seed 3 visible chips out of it; the rotation
  // effect further down swaps one chip at a time every few seconds.
  // Falls back to FALLBACK_QUESTIONS below if the array comes back empty
  // or the fetch fails.
  useEffect(() => {
    const id = machine?.id;
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/machines/${encodeURIComponent(id)}/suggestions`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as { suggestions?: string[] };
        if (cancelled) return;
        if (Array.isArray(body.suggestions) && body.suggestions.length > 0) {
          const pool = body.suggestions;
          const initial = pickRandom(pool, 3);
          setSuggestions(pool);
          setVisibleSuggestions(initial);
          visibleSuggestionsRef.current = initial;
          setChipVersions([0, 0, 0]);
        }
      } catch {
        // Swallow — UI already falls back to FALLBACK_QUESTIONS.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [machine?.id]);

  const isEmpty = messages.length === 0;

  // Rotate one chip every ~9s while the empty state is on screen and
  // there are unused questions in the pool. Skips entirely once the
  // operator starts the conversation.
  useEffect(() => {
    if (!isEmpty) return;
    if (suggestions.length <= 3) return;
    const id = setInterval(() => {
      const current = visibleSuggestionsRef.current;
      const unused = suggestions.filter((q) => !current.includes(q));
      if (unused.length === 0) return;
      const next = [...current];
      const pos = Math.floor(Math.random() * next.length);
      next[pos] = unused[Math.floor(Math.random() * unused.length)];
      visibleSuggestionsRef.current = next;
      setVisibleSuggestions(next);
      setChipVersions((v) => {
        const nv = [...v];
        nv[pos] = (v[pos] ?? 0) + 1;
        return nv;
      });
    }, 9000);
    return () => clearInterval(id);
  }, [isEmpty, suggestions]);

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

  // Revoke object URLs for any pending (un-sent) attachments when the
  // component unmounts. Sent messages keep their own object URLs alive
  // via the messages array — those are revoked implicitly on tab close.
  useEffect(() => {
    return () => {
      for (const p of pendingAttachments) URL.revokeObjectURL(p.previewUrl);
    };
    // We intentionally only want this on unmount, not on every change —
    // mid-session removal already revokes in removeAttachment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Upload a single image file. The pending entry is added immediately
  // so the operator sees a thumbnail with a spinner; on success we fill
  // in the server-side id, on failure we leave it as "error" so the X
  // is the only meaningful affordance.
  const uploadAttachment = useCallback(
    async (file: File) => {
      const localId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      setPendingAttachments((prev) => [
        ...prev,
        { localId, previewUrl, file, status: "uploading" },
      ]);
      try {
        if (!machine?.id) throw new Error("Missing machine");
        const form = new FormData();
        form.append("machineId", machine.id);
        form.append("file", file);
        const res = await fetchWithAuth("/api/chat/attachments", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Upload failed (${res.status})`);
        }
        const data = (await res.json()) as { id: string };
        setPendingAttachments((prev) =>
          prev.map((p) =>
            p.localId === localId ? { ...p, status: "ready", id: data.id } : p,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setPendingAttachments((prev) =>
          prev.map((p) =>
            p.localId === localId
              ? { ...p, status: "error", errorMessage: msg }
              : p,
          ),
        );
        setAttachmentError(msg);
      }
    },
    [machine],
  );

  const addAttachments = useCallback(
    (files: File[]) => {
      setAttachmentError(null);
      const slotsLeft = MAX_ATTACHMENTS - pendingAttachments.length;
      if (slotsLeft <= 0) {
        setAttachmentError(tChat("attachments.tooMany", { max: MAX_ATTACHMENTS }));
        return;
      }
      const accepted: File[] = [];
      let rejected = false;
      for (const f of files.slice(0, slotsLeft)) {
        const mimeOk = f.type === "image/png" || f.type === "image/jpeg" || f.type === "image/webp";
        if (!mimeOk) {
          rejected = true;
          continue;
        }
        if (f.size > ATTACHMENT_MAX_BYTES) {
          rejected = true;
          continue;
        }
        accepted.push(f);
      }
      if (rejected) {
        setAttachmentError(tChat("attachments.unsupported"));
      }
      if (files.length > slotsLeft) {
        setAttachmentError(tChat("attachments.tooMany", { max: MAX_ATTACHMENTS }));
      }
      for (const f of accepted) void uploadAttachment(f);
    },
    [pendingAttachments.length, tChat, uploadAttachment],
  );

  const removeAttachment = useCallback((localId: string) => {
    setPendingAttachments((prev) => {
      const next = prev.filter((p) => {
        if (p.localId === localId) {
          URL.revokeObjectURL(p.previewUrl);
          return false;
        }
        return true;
      });
      return next;
    });
  }, []);

  // Paste handler: turns clipboard images into attachments. Only active
  // while the textarea is focused so we don't fight other paste targets.
  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const files = items
        .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length > 0) {
        e.preventDefault();
        addAttachments(files);
      }
    },
    [addAttachments],
  );

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

      // All active channels (sms / email / webhook) are server-sent;
      // service_ticket exposes the share URL on the `done` view for the
      // operator to copy. Nothing to open client-side.

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
    // Snapshot ready attachments at send-time. Anything still uploading
    // or errored is left in the tray — the operator can either wait or
    // remove it; we don't drop spinners silently into the sent message.
    const readyAttachments = pendingAttachments.filter((p) => p.status === "ready");
    const hasAttachments = readyAttachments.length > 0;
    if ((!text && !hasAttachments) || streaming) return;
    // Any send means the operator isn't done — drop the idle prompt
    // (and any in-flight feedback state) so it doesn't sit there stale.
    clearIdleTimer();
    if (feedback.phase !== "hidden") setFeedback({ phase: "hidden" });

    const userAttachments: ChatAttachment[] = readyAttachments.map((p) => ({
      id: p.id!,
      previewUrl: p.previewUrl,
      mimeType: p.file.type,
    }));

    const next: Message[] = [
      ...messages,
      {
        role: "user",
        content: text,
        attachments: hasAttachments ? userAttachments : undefined,
      },
      { role: "assistant", content: "" },
    ];
    setMessages(next);
    setInput("");
    // Clear only the attachments we just sent. Leave any in-flight
    // uploads or errors so the operator notices them. Keep the object
    // URLs alive — the message thumbnails are still pointing at them.
    setPendingAttachments((prev) =>
      prev.filter((p) => !readyAttachments.some((r) => r.localId === p.localId)),
    );
    setAttachmentError(null);
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
          messages: next.slice(0, -1).map((m) => ({
            role: m.role,
            content: m.content,
            attachmentIds: m.attachments?.map((a) => a.id),
          })),
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
            // Text streaming resumed → the model is now writing its
            // reply, so any "Searching the manuals…" indicator from
            // the previous tool_use should disappear.
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant" && last.activeTool) {
                copy[copy.length - 1] = { ...last, activeTool: undefined };
              }
              return copy;
            });
          } else if (event === "conversation") {
            if (typeof data.id === "string") setConversationId(data.id);
          } else if (event === "tool_use") {
            // Either a custom tool (search_kb) or an MCP-side tool
            // Anthropic is invoking on our behalf. Stash the most
            // recent one on the streaming assistant message so the
            // row renders the indicator chip until text resumes (or
            // until a tool_result clears it for MCP).
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant") {
                copy[copy.length - 1] = {
                  ...last,
                  activeTool: {
                    name: typeof data.name === "string" ? data.name : "(tool)",
                    source: data.source === "mcp" ? "mcp" : undefined,
                    serverName:
                      typeof data.serverName === "string"
                        ? data.serverName
                        : undefined,
                  },
                };
              }
              return copy;
            });
          } else if (event === "tool_result") {
            // Only MCP emits these (custom tools' results land in
            // synthetic user turns the next iteration). Clear the
            // chip so the operator doesn't see a stale "Fetching …"
            // label while the model is back to thinking/writing.
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant" && last.activeTool) {
                copy[copy.length - 1] = { ...last, activeTool: undefined };
              }
              return copy;
            });
          } else if (event === "sources") {
            const sources = Array.isArray(data.sources)
              ? (data.sources as SourceRef[])
              : undefined;
            const images = Array.isArray(data.images)
              ? (data.images as ImageSourceRef[])
              : undefined;
            if (sources || images) {
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") {
                  copy[copy.length - 1] = {
                    ...last,
                    ...(sources ? { sources } : {}),
                    ...(images ? { images } : {}),
                  };
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
                content: tChat("errorPrefix", { message: data.message }),
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
            content: tChat("errorPrefix", { message: msg }),
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

  const hasAssistantReply = messages.some(
    (m) => m.role === "assistant" && m.content.length > 0,
  );
  const inputLocked =
    streaming || feedback.phase === "thanks" || escalate.phase === "done";
  const hasReadyAttachment = pendingAttachments.some((p) => p.status === "ready");
  const isUploadingAttachment = pendingAttachments.some(
    (p) => p.status === "uploading",
  );
  const canSend =
    !inputLocked &&
    !isUploadingAttachment &&
    (input.trim().length > 0 || hasReadyAttachment);
  const canAttach =
    !inputLocked &&
    !!machine?.id &&
    pendingAttachments.length < MAX_ATTACHMENTS;
  const showActionButtons =
    !!conversationId &&
    hasAssistantReply &&
    feedback.phase === "hidden" &&
    (escalate.phase === "hidden" || escalate.phase === "error");

  return (
    <div className="relative flex h-full flex-col bg-[var(--color-background)]">
      <AppHeader />

      <div ref={scrollRef} className="scroll-area flex-1 overflow-y-auto">
        {/* pb sized to clear the absolutely-positioned footer (24px fade
            + solid panel containing the input bar, optional "Afslut
            samtale" pill, and feedback card). Without enough room here,
            content scrolls under the panel. */}
        <div className="mx-auto max-w-3xl px-4 pt-6 pb-56 sm:px-6 sm:pt-12 sm:pb-72">
          {isEmpty ? (
            <p className="msg-in max-w-2xl text-[18px] leading-[1.5] tracking-[-0.005em] text-[var(--color-foreground)] sm:text-[22px] sm:leading-[1.55]">
              {tChat("emptyPrompt")}
            </p>
          ) : (
            <div className="flex flex-col gap-6 sm:gap-8">
              {messages.map((m, i) => (
                <MessageRow
                  key={i}
                  message={m}
                  isStreaming={streaming && i === messages.length - 1}
                  onCallService={() =>
                    setEscalate({ phase: "confirm", note: "" })
                  }
                />
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
          className="pointer-events-none h-30 w-full"
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
        <div className="mx-auto max-w-3xl px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 sm:px-4 sm:pb-8">
          {isEmpty && (
            <div className="msg-in mb-6 sm:mb-10">
              <div className="flex flex-wrap gap-2">
                {(visibleSuggestions.length > 0
                  ? visibleSuggestions
                  : FALLBACK_QUESTIONS
                ).map((q, i) => {
                  const v = chipVersions[i] ?? 0;
                  // On initial mount each slot uses chip-in (staggered
                  // entrance); after a rotation the slot remounts under a
                  // new key and uses chip-swap (snappy, no stagger).
                  const isSwap = v > 0;
                  return (
                    <Button
                      key={`${i}-${v}-${q}`}
                      variant="secondary"
                      size="sm"
                      onClick={() => send(q)}
                      disabled={streaming}
                      className={cn(
                        "max-w-full rounded-full whitespace-normal text-left sm:text-[14px]",
                        isSwap ? "chip-swap" : "chip-in",
                      )}
                      style={{ ["--chip-index" as string]: i }}
                    >
                      {q}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          {showActionButtons && (
            <div className="msg-in mb-4 flex flex-wrap justify-end gap-2 sm:mb-6">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEscalate({ phase: "confirm", note: "" })}
                className="sm:text-[14px]"
              >
                <Wrench className="mr-1.5 h-4 w-4" />
                {tChat("callService")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFeedback({ phase: "prompt" })}
                className="sm:text-[14px]"
              >
                {tChat("endConversation")}
              </Button>
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
          {voiceError && (
            <div
              className="mb-2 text-[14px]"
              style={{ color: "var(--ds-red)" }}
              role="status"
            >
              {voiceError}
            </div>
          )}
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAttachments.map((p) => (
                <AttachmentChip
                  key={p.localId}
                  attachment={p}
                  onRemove={() => removeAttachment(p.localId)}
                />
              ))}
            </div>
          )}
          {attachmentError && (
            <div
              className="mb-2 text-[13px]"
              style={{ color: "var(--ds-red)" }}
              role="status"
            >
              {attachmentError}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) addAttachments(files);
              e.target.value = "";
            }}
          />
          <div
            className={cn(
              "flex items-stretch gap-1.5 sm:gap-2",
              inputLocked && "opacity-60",
            )}
          >
            <FieldFrame
              focused={composerFocused}
              className="flex min-w-0 flex-1 items-end gap-0.5 p-[6px] sm:gap-1 sm:p-[8px]"
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canAttach}
                aria-label={tChat("attachments.addAria")}
                title={tChat("attachments.addAria")}
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                  "text-[var(--ds-grey-medium-04)] hover:bg-[var(--ds-grey-light-02)]",
                  "disabled:opacity-40 disabled:hover:bg-transparent",
                )}
              >
                <Plus className="h-5 w-5" />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
                onFocus={() => setComposerFocused(true)}
                onBlur={() => setComposerFocused(false)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }}
                placeholder={
                  feedback.phase === "thanks"
                    ? tChat("endedPlaceholder")
                    : voiceState === "recording"
                      ? tChat("recordingPlaceholder")
                      : voiceState === "transcribing"
                        ? tChat("transcribingPlaceholder")
                        : tChat("inputPlaceholder")
                }
                rows={1}
                disabled={inputLocked || voiceState !== "idle"}
                className={cn(
                  "min-w-0 flex-1 resize-none overflow-hidden bg-transparent outline-none",
                  "px-1.5 py-[8px] sm:px-2",
                  "font-['Hanken_Grotesk',sans-serif] font-normal",
                  "text-[16px] leading-[22px] sm:text-[19px] sm:leading-[26px]",
                  "text-[var(--ds-grey-dark-09)]",
                  "placeholder:text-[var(--ds-grey-light-03)]",
                  "disabled:cursor-not-allowed disabled:text-[var(--ds-grey-medium-05)]",
                )}
              />
              <button
                type="button"
                onClick={() =>
                  voiceState === "recording" ? stopVoice() : startVoice()
                }
                disabled={inputLocked || voiceState === "transcribing"}
                aria-label={
                  voiceState === "recording"
                    ? tChat("voiceLabels.stopRecording")
                    : voiceState === "transcribing"
                      ? tChat("voiceLabels.transcribing")
                      : tChat("voiceLabels.recordVoice")
                }
                title={
                  voiceState === "recording"
                    ? tChat("voiceLabels.stopRecording")
                    : tChat("voiceLabels.recordVoice")
                }
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors",
                  "text-[var(--ds-grey-medium-04)] hover:bg-[var(--ds-grey-light-02)]",
                  "disabled:opacity-40 disabled:hover:bg-transparent",
                  voiceState === "recording" &&
                    "bg-[var(--ds-red)] text-white hover:bg-[var(--ds-red-dark)] animate-pulse",
                )}
              >
                {voiceState === "transcribing" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : voiceState === "recording" ? (
                  <Square className="h-4 w-4" fill="currentColor" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </button>
            </FieldFrame>
            <Button
              size="lg"
              onClick={() => send()}
              disabled={!canSend}
              aria-label={tChat("send")}
              className="h-11 shrink-0 px-3 sm:h-auto sm:px-8"
            >
              {streaming ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <span
                    className={cn(
                      "hidden sm:inline-block",
                      canSend && "send-nudge",
                    )}
                  >
                    {tChat("send")}
                  </span>
                  <ArrowUp
                    className={cn(
                      "h-5 w-5 sm:hidden",
                      canSend && "send-nudge",
                    )}
                    aria-hidden
                  />
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={() => setVoiceConvOpen(true)}
              disabled={
                inputLocked ||
                voiceState !== "idle" ||
                !machine?.id ||
                !account?.id
              }
              aria-label={tChat("voiceLabels.startConversation")}
              title={tChat("voiceLabels.startConversation")}
              className={cn(
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border transition-colors sm:h-auto sm:w-[52px]",
                "border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)]",
                "hover:bg-[var(--color-muted)] disabled:opacity-60",
              )}
            >
              <AudioLines className="h-5 w-5" />
            </button>
          </div>
        </div>
        </div>
        <div className="brand-stripe" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </footer>
      {machine?.id ? <KnowledgeDrawer machineId={machine.id} /> : null}
      {voiceConvOpen && machine?.id && account?.id ? (
        <VoiceConversation
          machineId={machine.id}
          accountId={account.id}
          onClose={() => setVoiceConvOpen(false)}
        />
      ) : null}
    </div>
  );
}

function MessageRow({
  message,
  isStreaming,
  onCallService,
}: {
  message: Message;
  isStreaming?: boolean;
  onCallService?: () => void;
}) {
  if (message.role === "user") {
    const hasAttachments =
      !!message.attachments && message.attachments.length > 0;
    const hasText = message.content.length > 0;
    return (
      <div className="msg-in flex flex-col items-end gap-2">
        {hasAttachments && (
          <div className="flex max-w-[90%] flex-wrap justify-end gap-2 sm:max-w-[78%]">
            {message.attachments!.map((a) => (
              <a
                key={a.id}
                href={a.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block h-24 w-24 overflow-hidden rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-muted)] shadow-[var(--shadow-sm)] sm:h-28 sm:w-28"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.previewUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </a>
            ))}
          </div>
        )}
        {hasText && (
          <div
            className="max-w-[90%] rounded-[4px] px-4 py-2.5 text-[16px] leading-[1.5] whitespace-pre-wrap break-words shadow-[var(--shadow-sm)] sm:max-w-[78%] sm:px-5 sm:py-3 sm:text-[19px] sm:leading-[1.55]"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-primary-foreground)",
            }}
          >
            {message.content}
          </div>
        )}
      </div>
    );
  }

  if (!message.content) {
    // No text yet. If the model has already announced a tool call,
    // surface that instead of the generic "thinking…" so the operator
    // sees we're doing something specific.
    if (message.activeTool) {
      return <ToolUseIndicator tool={message.activeTool} />;
    }
    return <WorkingRow />;
  }

  return (
    <div className="msg-in flex flex-col gap-3">
      <div className="relative">
        <Markdown onCallService={onCallService}>{message.content}</Markdown>
        {isStreaming && (
          <span className="stream-caret -ml-0.5 align-baseline" aria-hidden />
        )}
      </div>
      {isStreaming && message.activeTool ? (
        <ToolUseIndicator tool={message.activeTool} />
      ) : null}
      {!isStreaming && (
        <div className="-mt-1 flex items-center">
          <SpeakButton text={message.content} />
        </div>
      )}
      {message.images && message.images.length > 0 && (
        <ImageSources images={message.images} />
      )}
      {message.sources && message.sources.length > 0 && (
        <SourceChips sources={message.sources} />
      )}
    </div>
  );
}

// Pre-send thumbnail with status overlay (spinner while uploading,
// red border on error). The X button is always available so the
// operator can clear a failed upload without retrying.
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const tCommon = useTranslations("common");
  const tChat = useTranslations("chat");
  return (
    <div
      className={cn(
        "relative h-20 w-20 overflow-hidden rounded-[6px] border bg-[var(--color-muted)] shadow-[var(--shadow-sm)]",
        attachment.status === "error"
          ? "border-[var(--ds-red)]"
          : "border-[var(--color-hairline)]",
      )}
      title={
        attachment.status === "error"
          ? attachment.errorMessage ?? tChat("attachments.failed")
          : attachment.file.name
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachment.previewUrl}
        alt=""
        className={cn(
          "h-full w-full object-cover",
          attachment.status !== "ready" && "opacity-60",
        )}
      />
      {attachment.status === "uploading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <Loader2 className="h-5 w-5 animate-spin text-white" />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={tCommon("close")}
        className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function WorkingRow() {
  const t = useTranslations("chat");
  return (
    <div className="msg-in flex items-center gap-2.5 text-[18px]">
      <span className="text-shimmer font-medium">{t("working")}</span>
    </div>
  );
}

// Tool-use indicator chip. Shown while a tool is currently being
// invoked — either our search_kb or an Anthropic-handled MCP tool.
// Friendly label mapping is best-effort; unknown tool names fall back
// to the raw identifier. The shimmer matches WorkingRow so the two
// indicators feel like one continuous "is doing something" state.
function ToolUseIndicator({ tool }: { tool: ActiveTool }) {
  const t = useTranslations("chat");
  // Translation keys for the labels we know about. We add the MCP
  // tool name as a hint at the end so the operator can see which
  // specific portal endpoint fired without us having to enumerate
  // every Optipeople tool here.
  let label: string;
  if (tool.name === "search_kb") {
    label = t("toolSearching");
  } else if (tool.source === "mcp") {
    label = `${t("toolFetchingMachineData")} (${tool.name})`;
  } else {
    label = `${t("toolRunning")} ${tool.name}`;
  }
  return (
    <div className="msg-in flex items-center gap-2.5 text-[14px] text-[var(--color-muted-foreground)] sm:text-[15px]">
      <span className="text-shimmer">{label}</span>
    </div>
  );
}

// Thumbnails (real <img>) for standalone uploaded images and clickable
// page cards for figures pulled out of a PDF. The signed URL is fetched
// lazily on mount per asset; if it fails we just hide the thumbnail —
// the source chip below still gives the operator a path to the doc.
function ImageSources({ images }: { images: ImageSourceRef[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-3 pt-1">
      {images.map((im) => (
        <ImageSourceCard key={im.assetId} image={im} />
      ))}
    </div>
  );
}

function ImageSourceCard({ image }: { image: ImageSourceRef }) {
  const tCommon = useTranslations("common");
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isPdfFigure = image.mimeType === "application/pdf";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/assets/${encodeURIComponent(image.assetId)}/url`,
        );
        if (!res.ok) throw new Error(`asset url ${res.status}`);
        const body = (await res.json()) as { url?: string };
        if (cancelled) return;
        if (body.url) setUrl(body.url);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [image.assetId]);

  if (failed) return null;

  function onClick() {
    if (!url) return;
    const target =
      isPdfFigure && image.pageFrom != null
        ? `${url}#page=${image.pageFrom}`
        : url;
    window.open(target, "_blank", "noopener,noreferrer");
  }

  const pageLabel =
    image.pageFrom != null ? ` · ${tCommon("page", { n: image.pageFrom })}` : "";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!url}
      title={`${image.altText} — ${image.documentTitle}${pageLabel}`}
      className={cn(
        "group flex w-44 flex-col gap-1.5 overflow-hidden rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1.5 text-left",
        "shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--color-brand)]/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        "disabled:cursor-default disabled:opacity-60",
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[4px] bg-[var(--color-muted)]">
        {url && !isPdfFigure ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={image.altText}
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--color-muted-foreground)]">
            {url ? (
              <FileText className="h-8 w-8" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
          </div>
        )}
      </div>
      <p className="line-clamp-2 px-0.5 text-[11px] leading-tight text-[var(--color-foreground)]">
        {image.altText}
      </p>
      <p className="line-clamp-1 px-0.5 text-[10px] text-[var(--color-muted-foreground)]">
        {image.documentTitle}
        {pageLabel}
      </p>
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
  const t = useTranslations("feedback");
  const tCommon = useTranslations("common");
  if (state.phase === "thanks") {
    return (
      <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-md)] sm:p-4">
        <div className="flex flex-col items-start gap-3 sm:flex-row">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-medium text-[var(--color-foreground)]">
              {t("thanksTitle")}
            </p>
            <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">
              {state.resolved ? t("thanksResolved") : t("thanksUnresolved")}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onStartNew}
            className="w-full sm:w-auto"
          >
            {t("startNew")}
          </Button>
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-[4px] border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{t("errorTitle")}</p>
            <p className="mt-0.5 text-[13px]">{state.message}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-red-700/70 hover:text-red-700"
            aria-label={tCommon("close")}
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
    <div className="rounded-[4px] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-md)] sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-[var(--color-foreground)]">
            {t("prompt")}
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--color-muted-foreground)]">
            {t("promptHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          disabled={submitting}
          className="shrink-0 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] disabled:opacity-50"
          aria-label={tCommon("close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {state.phase === "prompt" || state.phase === "submitting" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onAnswerYes} disabled={submitting}>
            <ThumbsUp className="mr-1.5 h-4 w-4" />
            {t("yes")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onAnswerNo}
            disabled={submitting}
          >
            <ThumbsDown className="mr-1.5 h-4 w-4" />
            {t("no")}
          </Button>
          {submitting && (
            <Loader2 className="ml-1 h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
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
  const t = useTranslations("feedback");
  return (
    <div className="mt-3 flex flex-col gap-2">
      <label
        htmlFor="solution"
        className="text-[12px] uppercase tracking-wide text-[var(--color-muted-foreground)]"
      >
        {t("solutionLabel")}
      </label>
      <Textarea
        id="solution"
        value={solution}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        disabled={submitting}
        placeholder={t("solutionPlaceholder")}
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onSkip}
          disabled={submitting}
        >
          {t("skip")}
        </Button>
        <Button size="sm" onClick={onSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("submit")}
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
  const t = useTranslations("escalate");
  if (state.phase === "done") {
    const target = state.label ?? state.target;
    return (
      <div className="rounded-[4px] border border-amber-200 bg-amber-50 p-3 shadow-[var(--shadow-md)] sm:p-4">
        <div className="flex flex-col items-start gap-3 sm:flex-row">
          <Wrench
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium text-amber-900">
              {t("doneTitle")}
            </p>
            <p className="mt-0.5 break-words text-[13px] text-amber-900/80">
              {state.channel === "sms"
                ? t("doneSms", { target })
                : state.channel === "email"
                  ? t("doneEmail", { target })
                  : state.channel === "webhook"
                    ? t("doneWebhook", { label: state.label ?? "none" })
                    : t("doneServiceTicket")}
            </p>
            {state.channel === "service_ticket" && (
              <ShareLinkRow url={state.shareUrl} />
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onStartNew}
            className="w-full sm:w-auto"
          >
            {t("startNew")}
          </Button>
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-[4px] border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{t("errorTitle")}</p>
            <p className="mt-0.5 text-[13px]">{state.message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-red-700/70 hover:text-red-700"
            aria-label={t("cancel")}
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
    <div className="rounded-[4px] border border-amber-200 bg-amber-50/60 p-3 shadow-[var(--shadow-md)] sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-amber-900">
            {t("confirmTitle")}
          </p>
          <p className="mt-0.5 text-[13px] text-amber-900/80">
            {t("confirmHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="shrink-0 text-amber-900/60 hover:text-amber-900 disabled:opacity-50"
          aria-label={t("cancel")}
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
          placeholder={t("notePlaceholder")}
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
          >
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => onSubmit(note)}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="h-4 w-4" />
                {t("submit")}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ShareLinkRow({ url }: { url: string }) {
  const t = useTranslations("escalate");
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
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 truncate rounded-[var(--radius)] border border-amber-200 bg-white px-3 py-1.5 text-[12px] text-amber-900"
      />
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] border border-amber-200 bg-white px-3 py-1.5 text-[13px] text-amber-900 hover:bg-amber-100"
      >
        {copied ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            {t("copied")}
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" />
            {t("copy")}
          </>
        )}
      </button>
    </div>
  );
}
