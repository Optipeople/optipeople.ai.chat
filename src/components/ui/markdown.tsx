"use client";

import {
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, FileText, Wrench } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { fetchWithAuth } from "@/auth/authApi";
import { useFileViewer } from "@/components/FileViewer";
import { cn } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";
import { slugify } from "@/lib/slug";

// Walks a ReactMarkdown children tree and concatenates the text content.
// Needed to compute a slug from a heading like ["1. Definitioner"] where
// the children is an array of strings or wrapped React elements.
function flattenChildren(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenChildren).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return flattenChildren(props.children);
  }
  return "";
}

// Sentinel href the model emits as `[label](opti:call-service)` when it
// recommends human help. The link renderer turns the anchor into an
// inline pill button that calls the same handler as the bottom
// "Tilkald service" button.
const CALL_SERVICE_HREF = "opti:call-service";

// Sentinel schemes the model can emit to embed a clickable PDF link
// (`opti:doc/<documentId>` or `opti:doc/<documentId>?page=12`) or an
// inline figure (`opti:asset/<assetId>`) directly inside its prose.
// Parsed below by `parseOptiDocHref` / `parseOptiAssetHref` and turned
// into components that hit the signed-URL endpoints on demand. The
// chip / image rail below the message stays — these inline forms are
// for pointed references inside the answer itself.
type OptiDocRef = { id: string; page: number | null };
type OptiAssetRef = { id: string };

function parseOptiDocHref(href: string | undefined): OptiDocRef | null {
  if (!href || !href.startsWith("opti:doc/")) return null;
  const rest = href.slice("opti:doc/".length);
  if (!rest) return null;
  const qIdx = rest.indexOf("?");
  const id = qIdx === -1 ? rest : rest.slice(0, qIdx);
  if (!id) return null;
  let page: number | null = null;
  if (qIdx !== -1) {
    const params = new URLSearchParams(rest.slice(qIdx + 1));
    const p = params.get("page");
    if (p && /^\d+$/.test(p)) page = parseInt(p, 10);
  }
  return { id, page };
}

function parseOptiAssetHref(src: string | undefined): OptiAssetRef | null {
  if (!src || !src.startsWith("opti:asset/")) return null;
  const id = src.slice("opti:asset/".length);
  if (!id) return null;
  return { id };
}

// Inline clickable link to a kb_document, embedded mid-prose by the
// model via `[label](opti:doc/<id>[?page=N])`. Opens the FileViewer
// modal so the operator never leaves the chat for a quick look.
function InlineDocLink({
  href,
  page,
  children,
}: {
  href: string;
  page: number | null;
  children: ReactNode;
}) {
  const viewer = useFileViewer();
  const ref = parseOptiDocHref(href);

  function onClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (!ref) return;
    viewer.open({ kind: "doc", id: ref.id, page });
  }

  return (
    <a
      href="#"
      onClick={onClick}
      className={cn(
        "inline-flex items-baseline gap-1 font-medium text-[var(--color-accent)]",
        "underline decoration-[var(--color-accent)]/30 underline-offset-2",
        "hover:decoration-[var(--color-accent)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-1 rounded-sm",
      )}
    >
      <FileText className="h-3 w-3 shrink-0 translate-y-[1px]" />
      <span>{children}</span>
      <ExternalLink className="h-3 w-3 shrink-0 translate-y-[1px] text-[var(--color-muted-foreground)]" />
    </a>
  );
}

// Inline figure embedded mid-prose by the model via
// `![alt](opti:asset/<assetId>)`. Lazy-fetches the signed URL once;
// failure collapses the figure silently (the chip rail below still
// shows the same thumbnail). Constrained to a sensible inline size
// and click-to-open at full resolution.
function InlineAssetImage({
  assetId,
  alt,
}: {
  assetId: string;
  alt: string;
}) {
  const viewer = useFileViewer();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/assets/${encodeURIComponent(assetId)}/url`,
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
  }, [assetId]);

  if (failed) return null;

  if (!url) {
    return (
      <span
        className={cn(
          "my-3 flex h-32 w-full max-w-sm items-center justify-center",
          "rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-muted)]",
        )}
      >
        <Spinner className="h-4 w-4" />
      </span>
    );
  }

  return (
    <span className="my-3 flex max-w-md flex-col gap-1">
      <button
        type="button"
        onClick={() =>
          viewer.open({ kind: "asset", id: assetId, title: alt })
        }
        className={cn(
          "block overflow-hidden rounded-[6px] border border-[var(--color-hairline)] bg-[var(--color-surface)]",
          "shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--color-brand)]/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
        )}
        aria-label={alt}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="block h-auto max-h-80 w-full object-contain"
        />
      </button>
      {alt && (
        <span className="px-1 text-[12px] italic text-[var(--color-muted-foreground)]">
          {alt}
        </span>
      )}
    </span>
  );
}

const baseComponents: Components = {
  p: ({ className, ...props }) => (
    <p
      className={cn("my-2 first:mt-0 last:mb-0 leading-[1.65]", className)}
      {...props}
    />
  ),
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "mt-6 mb-3 first:mt-0 text-[24px] font-semibold tracking-tight text-[var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "mt-6 mb-3 first:mt-0 text-[22px] font-semibold tracking-tight text-[var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "mt-5 mb-2 first:mt-0 text-[20px] font-semibold tracking-tight text-[var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "mt-5 mb-2 first:mt-0 text-[18px] font-semibold text-[var(--color-accent)]",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "my-2 ml-1 list-none space-y-1.5 [&_ul]:mt-1.5 [&_ul]:ml-4",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "my-2 ml-5 list-decimal space-y-1.5 marker:text-[var(--color-accent)] marker:font-semibold",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, children, ...props }) => (
    <li
      className={cn(
        "relative pl-5 leading-[1.6]",
        "before:absolute before:left-0 before:top-[0.65em] before:h-[6px] before:w-[6px] before:rounded-full before:bg-[var(--color-accent)]/80",
        "[ol_&]:pl-1 [ol_&]:before:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </li>
  ),
  strong: ({ className, ...props }) => (
    <strong
      className={cn(
        "font-semibold text-[var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  ),
  em: ({ className, ...props }) => (
    <em className={cn("italic", className)} {...props} />
  ),
  a: ({ className, href, children, ...props }) => {
    const docRef = parseOptiDocHref(href);
    if (docRef) {
      return (
        <InlineDocLink href={href ?? ""} page={docRef.page}>
          {children}
        </InlineDocLink>
      );
    }
    return (
      <a
        className={cn(
          "font-medium text-[var(--color-accent)] underline decoration-[var(--color-accent)]/30 underline-offset-2 hover:decoration-[var(--color-accent)]",
          className,
        )}
        href={href}
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  img: ({ className, src, alt, ...props }) => {
    const assetRef = parseOptiAssetHref(typeof src === "string" ? src : undefined);
    if (assetRef) {
      return <InlineAssetImage assetId={assetRef.id} alt={alt ?? ""} />;
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={cn("my-3 h-auto max-w-full rounded-[6px]", className)}
        src={typeof src === "string" ? src : undefined}
        alt={alt ?? ""}
        loading="lazy"
        {...props}
      />
    );
  },
  code: ({ className, children, ...props }) => {
    const isBlock = /\n/.test(String(children ?? ""));
    if (isBlock) {
      return (
        <code
          className={cn(
            "block font-mono text-[12.5px] leading-[1.55]",
            className,
          )}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className={cn(
          "rounded-[6px] bg-[var(--color-subtle)] px-[5px] py-[1px] font-mono text-[0.88em] text-[var(--color-accent)]",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-3 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-subtle)] p-3 text-[var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "my-3 border-l-2 border-[var(--color-accent)]/50 bg-[var(--color-muted)] px-3 py-2 text-[var(--color-muted-foreground)] italic",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn(
        "my-4 border-0 border-t border-[var(--color-hairline)]",
        className,
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table
        className={cn(
          "w-full border-collapse text-[13.5px]",
          className,
        )}
        {...props}
      />
    </div>
  ),
  thead: ({ className, ...props }) => (
    <thead
      className={cn(
        "border-b border-[var(--color-border)] text-left",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "px-3 py-1.5 font-semibold text-[var(--color-foreground)]",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "border-b border-[var(--color-hairline)] px-3 py-1.5 align-top",
        className,
      )}
      {...props}
    />
  ),
};

export function Markdown({
  children,
  className,
  onCallService,
  withHeadingIds,
}: {
  children: string;
  className?: string;
  onCallService?: () => void;
  // When true, h2 elements get an id derived from their text content so
  // anchor navigation works (used by the legal pages' table of contents).
  withHeadingIds?: boolean;
}) {
  const components = useMemo<Components>(() => {
    let result: Components = baseComponents;

    if (withHeadingIds) {
      result = {
        ...result,
        h2: ({ className: hClass, children: hChildren, ...rest }) => (
          <h2
            id={slugify(flattenChildren(hChildren))}
            className={cn(
              "mt-6 mb-3 first:mt-0 scroll-mt-6 text-[22px] font-semibold tracking-tight text-[var(--color-foreground)]",
              hClass,
            )}
            {...rest}
          >
            {hChildren}
          </h2>
        ),
      };
    }

    if (onCallService) {
      result = {
        ...result,
        a: ({ className: aClass, href, children: aChildren, ...rest }) => {
          if (href === CALL_SERVICE_HREF) {
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onCallService();
                }}
                className={cn(
                  buttonClasses({ variant: "secondary", size: "sm" }),
                  "mx-0.5 align-baseline gap-1",
                )}
              >
                <Wrench className="h-3 w-3" />
                {aChildren}
              </button>
            );
          }
          const docRef = parseOptiDocHref(href);
          if (docRef) {
            return (
              <InlineDocLink href={href ?? ""} page={docRef.page}>
                {aChildren}
              </InlineDocLink>
            );
          }
          return (
            <a
              className={cn(
                "font-medium text-[var(--color-accent)] underline decoration-[var(--color-accent)]/30 underline-offset-2 hover:decoration-[var(--color-accent)]",
                aClass,
              )}
              href={href}
              target="_blank"
              rel="noreferrer"
              {...rest}
            >
              {aChildren}
            </a>
          );
        },
      };
    }

    return result;
  }, [onCallService, withHeadingIds]);

  // The escalation pill only renders where the model explicitly emits
  // the `opti:call-service` link — blanket-matching the word "service"
  // in prose turned phrases like "service manual" into buttons.
  const plugins = useMemo(() => [remarkGfm], []);

  return (
    <div
      className={cn(
        "text-[16px] leading-[1.6] text-[var(--color-foreground)] break-words sm:text-[19px] sm:leading-[1.7]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={plugins}
        components={components}
        urlTransform={(url) =>
          url.startsWith("opti:") ? url : defaultUrlTransform(url)
        }
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
