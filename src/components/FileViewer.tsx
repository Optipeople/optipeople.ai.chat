"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, X } from "lucide-react";
import { fetchWithAuth } from "@/auth/authApi";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Centralized file viewer for kb_documents and kb_assets. Renders PDFs in
// an iframe, images in an <img>, and falls back to "open in a new tab"
// for anything we can't preview. All in-app document/image clicks should
// flow through this so the operator never bounces away from the chat for
// a quick look at a manual page or figure.

type ViewerRequest =
  | {
      kind: "doc";
      id: string;
      title?: string;
      page?: number | null;
    }
  | {
      kind: "asset";
      id: string;
      title?: string;
      mimeType?: string;
      page?: number | null;
    };

type ResolvedFile = {
  url: string;
  title: string;
  mimeType: string;
  page: number | null;
};

type FileViewerContextValue = {
  open: (req: ViewerRequest) => void;
};

const FileViewerContext = createContext<FileViewerContextValue | null>(null);

export function useFileViewer(): FileViewerContextValue {
  const ctx = useContext(FileViewerContext);
  if (ctx) return ctx;
  // Outside the provider (e.g. legacy callers), fall back to the
  // previous behaviour: pop a window and fetch the signed URL into it.
  // Keeps any stray caller working even without the provider mounted.
  return {
    open: (req) => {
      const popup =
        typeof window !== "undefined" ? window.open("", "_blank") : null;
      (async () => {
        try {
          const path =
            req.kind === "doc"
              ? `/api/documents/${encodeURIComponent(req.id)}/url`
              : `/api/assets/${encodeURIComponent(req.id)}/url`;
          const res = await fetchWithAuth(path);
          if (!res.ok) throw new Error(`Server error ${res.status}`);
          const body = (await res.json()) as {
            url?: string;
            pageFrom?: number | null;
          };
          if (!body.url) throw new Error("missing url");
          const page = req.page ?? body.pageFrom ?? null;
          const target = page != null ? `${body.url}#page=${page}` : body.url;
          if (popup) popup.location.href = target;
          else window.open(target, "_blank", "noopener,noreferrer");
        } catch {
          popup?.close();
        }
      })();
    },
  };
}

type LoadState =
  | { phase: "loading"; request: ViewerRequest }
  | { phase: "ready"; request: ViewerRequest; file: ResolvedFile }
  | { phase: "error"; request: ViewerRequest; message: string };

export function FileViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState | null>(null);
  const t = useTranslations("viewer");

  const close = useCallback(() => setState(null), []);

  const open = useCallback(
    (req: ViewerRequest) => {
      setState({ phase: "loading", request: req });
      (async () => {
        try {
          const path =
            req.kind === "doc"
              ? `/api/documents/${encodeURIComponent(req.id)}/url`
              : `/api/assets/${encodeURIComponent(req.id)}/url`;
          const res = await fetchWithAuth(path);
          if (!res.ok) throw new Error(`Server error ${res.status}`);
          const body = (await res.json()) as {
            url?: string;
            title?: string;
            mimeType?: string;
            sourceType?: string;
            pageFrom?: number | null;
            altText?: string | null;
          };
          if (!body.url) throw new Error(t("missingUrl"));

          // Asset endpoint returns mimeType directly. Doc endpoint
          // doesn't store mime, so map from source_type. Anything that
          // isn't "image" we treat as PDF — that's true for every
          // non-image doc currently in the system.
          let mime =
            body.mimeType ??
            (req.kind === "asset" ? req.mimeType : undefined) ??
            "";
          if (!mime) {
            mime =
              body.sourceType === "image"
                ? "image/*"
                : "application/pdf";
          }

          setState({
            phase: "ready",
            request: req,
            file: {
              url: body.url,
              title: body.title ?? req.title ?? body.altText ?? "",
              mimeType: mime,
              page: req.page ?? body.pageFrom ?? null,
            },
          });
        } catch (err) {
          setState({
            phase: "error",
            request: req,
            message: err instanceof Error ? err.message : t("openFailed"),
          });
        }
      })();
    },
    [t],
  );

  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  useEffect(() => {
    if (!state) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [state]);

  return (
    <FileViewerContext.Provider value={{ open }}>
      {children}
      {state && <ViewerModal state={state} onClose={close} />}
    </FileViewerContext.Provider>
  );
}

function ViewerModal({
  state,
  onClose,
}: {
  state: LoadState;
  onClose: () => void;
}) {
  const t = useTranslations("viewer");
  const tCommon = useTranslations("common");
  const title =
    state.phase === "ready"
      ? state.file.title
      : state.request.title ?? tCommon("loading");
  const externalHref =
    state.phase === "ready"
      ? state.file.page != null
        ? `${state.file.url}#page=${state.file.page}`
        : state.file.url
      : null;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header
        className={cn(
          "flex items-center justify-between gap-3 border-b border-[var(--color-hairline)]",
          "bg-[var(--color-surface)] px-4 py-3 text-[var(--color-foreground)]",
          "shadow-[var(--shadow-sm)] sm:px-5",
        )}
      >
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight sm:text-[16px]">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {externalHref && (
            <a
              href={externalHref}
              target="_blank"
              rel="noreferrer"
              aria-label={t("openInNewTab")}
              title={t("openInNewTab")}
              className={cn(
                buttonClasses({ variant: "secondary", size: "sm" }),
                "gap-1.5",
              )}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("openInNewTab")}</span>
            </a>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={onClose}
            aria-label={tCommon("close")}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            <span>{tCommon("close")}</span>
          </Button>
        </div>
      </header>
      <div
        className="flex flex-1 items-center justify-center overflow-hidden"
        onClick={(e) => {
          // Click on the empty backdrop area closes; clicks inside the
          // viewer itself don't propagate here.
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {state.phase === "loading" && (
          <Loader2 className="h-8 w-8 animate-spin text-white/70" />
        )}
        {state.phase === "error" && (
          <div className="max-w-md rounded-md bg-white/5 px-4 py-3 text-center text-[14px] text-white/80">
            {state.message}
          </div>
        )}
        {state.phase === "ready" && (
          <ViewerContent file={state.file} t={t} />
        )}
      </div>
    </div>
  );
}

function ViewerContent({
  file,
  t,
}: {
  file: ResolvedFile;
  t: (key: string) => string;
}) {
  if (file.mimeType.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={file.url}
        alt={file.title}
        className="max-h-full max-w-full object-contain"
      />
    );
  }
  if (file.mimeType === "application/pdf") {
    const src = file.page != null ? `${file.url}#page=${file.page}` : file.url;
    return (
      <iframe
        src={src}
        title={file.title}
        className="h-full w-full border-0 bg-white"
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 text-white">
      <p className="text-[14px]">{t("cannotPreview")}</p>
      <a
        href={file.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-[14px] hover:bg-white/20"
      >
        <ExternalLink className="h-4 w-4" />
        {t("openInNewTab")}
      </a>
    </div>
  );
}
