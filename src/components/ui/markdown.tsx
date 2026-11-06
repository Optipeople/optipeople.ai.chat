"use client";

import {
  createContext,
  useCallback,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { PluggableList } from "unified";
import { Check, ExternalLink, FileText, Wrench } from "lucide-react";
import { CodeBlock } from "@/components/ui/markdown/code-block";
import { ChartBlock } from "@/components/ui/markdown/chart-block";
import { KpiBlock } from "@/components/ui/markdown/kpi-block";
import { QuestionsBlock } from "@/components/ui/markdown/questions-block";
import { Callout, type CalloutKind } from "@/components/ui/markdown/callout";
import { TermChip, isTermKind } from "@/components/ui/markdown/term-chip";
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

// --- Rich formatting -------------------------------------------------

// Minimal mdast shapes for the callout plugin. Kept local so we do not
// pull in @types/mdast for three fields.
type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

const CALLOUT_KINDS: readonly CalloutKind[] = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
];
function isCalloutKind(s: string): s is CalloutKind {
  return (CALLOUT_KINDS as readonly string[]).includes(s);
}

const CALLOUT_MARKER =
  /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i;

// GitHub style alerts: a blockquote whose first line is `[!WARNING]`
// becomes a callout box. The marker is stripped from the text and the
// blockquote is re-tagged as a div carrying `data-callout`, which the
// `div` renderer below picks up.
function remarkCallouts() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (node.type === "blockquote") {
        const first = node.children?.[0];
        const text =
          first?.type === "paragraph" ? first.children?.[0] : undefined;
        const match =
          text?.type === "text" ? CALLOUT_MARKER.exec(text.value ?? "") : null;
        if (first && text && match) {
          text.value = (text.value ?? "").slice(match[0].length);
          if (!text.value) first.children = first.children?.slice(1);
          if (first.children?.[0]?.type === "break") {
            first.children = first.children.slice(1);
          }
          if (!first.children?.length) node.children = node.children?.slice(1);
          node.data = {
            hName: "div",
            hProperties: { "data-callout": match[1].toLowerCase() },
          };
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

// Numbers, measurements and codes read better right-aligned in tabular
// figures: "12.5", "-3 %", "24 V", "1,200 rpm", "±0.02 mm".
const NUMERIC_CELL =
  /^[±+\-−~≈]?\s*\d[\d\s.,]*\s*(%|°C?|[a-zA-Zµ/²³]{1,5})?(\s*\/\s*\d[\d\s.,]*)?$/;

// Marks table columns whose body cells are mostly numbers, so the whole
// column (header included) is right-aligned in tabular figures. Per
// cell detection left "2179 / 423" hanging left among right-aligned
// percentages. Columns the author aligned explicitly are left alone.
function rehypeNumericColumns() {
  const cellsOf = (row: HastNode) =>
    (row.children ?? []).filter(
      (c) => c.type === "element" && (c.tagName === "td" || c.tagName === "th"),
    );
  const rowsOf = (node: HastNode | undefined) =>
    (node?.children ?? []).filter(
      (c) => c.type === "element" && c.tagName === "tr",
    );
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (node.type === "element" && node.tagName === "table") {
        const part = (tag: string) =>
          node.children?.find((c) => c.type === "element" && c.tagName === tag);
        const head = rowsOf(part("thead"));
        const body = rowsOf(part("tbody"));
        const width = Math.max(0, ...body.map((r) => cellsOf(r).length));
        for (let col = 0; col < width; col++) {
          const texts = body
            .map((r) => hastText(cellsOf(r)[col]).trim())
            .filter(Boolean);
          const numeric = texts.filter((t) => NUMERIC_CELL.test(t)).length;
          if (!texts.length || numeric / texts.length < 0.6) continue;
          for (const row of [...head, ...body]) {
            const cell = cellsOf(row)[col];
            if (!cell || cell.properties?.align) continue;
            cell.properties = { ...cell.properties, dataNumeric: "" };
          }
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

const HEADING_BASE =
  "font-semibold tracking-tight text-[var(--color-foreground)]";

const linkClass =
  "font-medium text-[var(--color-accent)] underline decoration-[var(--color-accent)]/30 underline-offset-2 hover:decoration-[var(--color-accent)]";

const TERM_PREFIX = "opti:term/";

// Whether the answer is still streaming. Carried by context rather than
// through buildComponents so the end of a stream does not rebuild the
// renderers and remount the whole answer.
const StreamingContext = createContext(false);

function FenceBlock({
  lang,
  source,
  onAsk,
}: {
  lang: string | undefined;
  source: string;
  onAsk?: (q: string) => void;
}) {
  const streaming = useContext(StreamingContext);
  switch (lang) {
    case "chart":
      return <ChartBlock source={source} streaming={streaming} />;
    case "kpi":
    case "kpis":
      return <KpiBlock source={source} streaming={streaming} />;
    case "questions":
    case "followups":
      // Half-written questions would be clickable mid-stream.
      return streaming ? null : (
        <QuestionsBlock source={source} onAsk={onAsk} />
      );
    default:
      return <CodeBlock language={lang} code={source} />;
  }
}

// `node: _node` pulls the hast node out of the props so it is not
// spread onto a DOM element as an attribute.
/* eslint-disable @typescript-eslint/no-unused-vars */
function buildComponents({
  onCallService,
  onAsk,
  withHeadingIds,
}: {
  onCallService?: () => void;
  onAsk?: (q: string) => void;
  withHeadingIds?: boolean;
}): Components {
  return {
    p: ({ className, node: _node, ...props }) => (
      <p
        className={cn("my-3 first:mt-0 last:mb-0 leading-[1.65]", className)}
        {...props}
      />
    ),
    h1: ({ className, node: _node, ...props }) => (
      <h1
        className={cn(
          "mt-8 mb-3 first:mt-0 text-[1.45em] leading-tight",
          HEADING_BASE,
          className,
        )}
        {...props}
      />
    ),
    h2: ({ className, node: _node, children, ...props }) => (
      <h2
        id={withHeadingIds ? slugify(flattenChildren(children)) : undefined}
        className={cn(
          "mt-7 mb-3 first:mt-0 text-[1.25em] leading-snug",
          withHeadingIds && "scroll-mt-6",
          HEADING_BASE,
          className,
        )}
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ className, node: _node, ...props }) => (
      <h3
        className={cn(
          "mt-6 mb-2 first:mt-0 text-[1.08em] leading-snug",
          HEADING_BASE,
          className,
        )}
        {...props}
      />
    ),
    h4: ({ className, node: _node, ...props }) => (
      <h4
        className={cn(
          "mt-5 mb-1.5 first:mt-0 text-[0.8em] font-semibold uppercase tracking-[0.06em] text-[var(--ds-grey-medium-05)]",
          className,
        )}
        {...props}
      />
    ),
    ul: ({ className, node: _node, ...props }) => (
      <ul
        className={cn(
          "my-3 first:mt-0 last:mb-0 list-none space-y-1.5 [&_ul]:mt-1.5 [&_ul]:mb-0 [&_ol]:mt-1.5 [&_ol]:mb-0",
          className,
        )}
        {...props}
      />
    ),
    // Numbered lists render as step badges via a CSS counter, which reads
    // far better for procedures than a bare "1." marker.
    ol: ({ className, node: _node, start, style, ...props }) => (
      <ol
        start={start}
        style={{
          ...style,
          counterReset: `step ${typeof start === "number" ? start - 1 : 0}`,
        }}
        className={cn(
          "my-3 first:mt-0 last:mb-0 list-none space-y-2.5",
          className,
        )}
        {...props}
      />
    ),
    li: ({ className, node: _node, children, ...props }) => {
      const isTask = className?.includes("task-list-item");
      return (
        <li
          className={cn(
            "relative leading-[1.6]",
            isTask
              ? "flex items-start gap-2.5"
              : [
                  // Bullet
                  "pl-5 before:absolute before:left-1 before:top-[0.68em] before:h-[6px] before:w-[6px] before:rounded-full before:bg-[var(--color-accent)]/70",
                  // Step badge when the parent is an <ol>
                  "[ol>&]:pl-9 [ol>&]:[counter-increment:step] [ol>&]:before:content-[counter(step)]",
                  "[ol>&]:before:left-0 [ol>&]:before:top-[0.12em] [ol>&]:before:flex [ol>&]:before:h-[2.1em] [ol>&]:before:w-[2.1em]",
                  "[ol>&]:before:items-center [ol>&]:before:justify-center [ol>&]:before:rounded-full",
                  "[ol>&]:before:bg-[var(--color-brand)] [ol>&]:before:text-[0.7em] [ol>&]:before:font-semibold [ol>&]:before:leading-none",
                  "[ol>&]:before:text-white [ol>&]:before:tabular-nums",
                ],
            className,
          )}
          {...props}
        >
          {children}
        </li>
      );
    },
    // GFM task list checkbox. Read-only: a chat answer is not a form.
    input: ({ checked, type }) => {
      if (type !== "checkbox") return null;
      return (
        <span
          aria-hidden
          className={cn(
            "mt-[0.3em] inline-flex h-[1.05em] w-[1.05em] shrink-0 items-center justify-center rounded-[4px] border",
            checked
              ? "border-[var(--ds-green)] bg-[var(--ds-green)] text-white"
              : "border-[var(--ds-grey-light-03)] bg-[var(--color-surface)]",
          )}
        >
          {checked && (
            <Check className="h-[0.75em] w-[0.75em]" strokeWidth={3} />
          )}
        </span>
      );
    },
    strong: ({ className, node: _node, ...props }) => (
      <strong
        className={cn(
          "font-semibold text-[var(--color-foreground)]",
          className,
        )}
        {...props}
      />
    ),
    em: ({ className, node: _node, ...props }) => (
      <em className={cn("italic", className)} {...props} />
    ),
    del: ({ className, node: _node, ...props }) => (
      <del
        className={cn(
          "text-[var(--color-muted-foreground)] decoration-[var(--color-muted-foreground)]/60",
          className,
        )}
        {...props}
      />
    ),
    a: ({ className, href, children, node: _node, ...props }) => {
      if (href === CALL_SERVICE_HREF) {
        // No escalation handler in this context (fleet scope, legal
        // pages): the sentinel must not become a dead link.
        if (!onCallService) return <span>{children}</span>;
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
            {children}
          </button>
        );
      }
      if (href?.startsWith(TERM_PREFIX)) {
        const kind = href.slice(TERM_PREFIX.length);
        if (isTermKind(kind)) {
          return <TermChip kind={kind}>{children}</TermChip>;
        }
        return <strong className="font-semibold">{children}</strong>;
      }
      const docRef = parseOptiDocHref(href);
      if (docRef) {
        return (
          <InlineDocLink href={href ?? ""} page={docRef.page}>
            {children}
          </InlineDocLink>
        );
      }
      // Footnote references and back links stay in-page.
      if (href?.startsWith("#")) {
        return (
          <a
            className={cn(linkClass, "no-underline", className)}
            href={href}
            {...props}
          >
            {children}
          </a>
        );
      }
      return (
        <a
          className={cn(linkClass, className)}
          href={href}
          target="_blank"
          rel="noreferrer"
          {...props}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => {
      const assetRef = parseOptiAssetHref(
        typeof src === "string" ? src : undefined,
      );
      if (assetRef) {
        return <InlineAssetImage assetId={assetRef.id} alt={alt ?? ""} />;
      }
      // Anything that isn't one of our signed assets is a URL the model
      // made up or copied from a manual. Never hot-load it as an <img>
      // (tracking, mixed content, broken boxes). Surface it as a plain
      // link the operator can choose to open.
      const href = typeof src === "string" ? src : "";
      if (!href) return null;
      return (
        <a className={linkClass} href={href} target="_blank" rel="noreferrer">
          {alt || href}
        </a>
      );
    },
    // Inline code only: fenced blocks are taken over by `pre` below, so
    // this renderer never sees them.
    code: ({ className, node: _node, ...props }) => (
      <code
        className={cn(
          "rounded-[5px] border border-[var(--color-hairline)] bg-[var(--ds-grey-light-01)] px-[5px] py-[1px] font-mono text-[0.84em] text-[var(--ds-grey-medium-06)]",
          className,
        )}
        {...props}
      />
    ),
    // Fenced blocks. The fence language picks the renderer: rich blocks
    // (chart, kpi, questions) or a highlighted code block.
    pre: ({ node }) => {
      const codeEl = (node as HastNode | undefined)?.children?.find(
        (c) => c.type === "element" && c.tagName === "code",
      );
      const classes =
        (codeEl?.properties?.className as string[] | undefined) ?? [];
      const lang = classes
        .find((c) => typeof c === "string" && c.startsWith("language-"))
        ?.slice("language-".length)
        .toLowerCase();
      const source = hastText(codeEl);
      return <FenceBlock lang={lang} source={source} onAsk={onAsk} />;
    },
    div: ({ node: _node, children, ...props }) => {
      const kind = (props as Record<string, unknown>)["data-callout"];
      if (typeof kind === "string" && isCalloutKind(kind)) {
        return <Callout kind={kind}>{children}</Callout>;
      }
      return <div {...props}>{children}</div>;
    },
    blockquote: ({ className, node: _node, ...props }) => (
      <blockquote
        className={cn(
          "my-4 border-l-[3px] border-[var(--ds-grey-light-03)] pl-4 text-[var(--ds-grey-medium-05)]",
          "[&>p]:my-1.5",
          className,
        )}
        {...props}
      />
    ),
    hr: ({ className, node: _node, ...props }) => (
      <hr
        className={cn(
          "my-6 border-0 border-t border-[var(--color-hairline)]",
          className,
        )}
        {...props}
      />
    ),
    table: ({ className, node: _node, ...props }) => (
      <div className="my-4 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[var(--shadow-sm)]">
        <table
          className={cn(
            "w-full border-collapse text-[0.84em] leading-[1.5]",
            className,
          )}
          {...props}
        />
      </div>
    ),
    thead: ({ className, node: _node, ...props }) => (
      <thead
        className={cn("bg-[var(--ds-panel-header-bg)] text-left", className)}
        {...props}
      />
    ),
    tbody: ({ className, node: _node, ...props }) => (
      <tbody
        className={cn(
          "[&>tr:nth-child(even)]:bg-[var(--ds-grey-light-01)] [&>tr]:transition-colors [&>tr:hover]:bg-[var(--ds-table-blue-hover)]",
          className,
        )}
        {...props}
      />
    ),
    th: ({ className, node: _node, ...props }) => (
      <th
        className={cn(
          "whitespace-nowrap border-b border-[var(--color-border)] px-3.5 py-2.5 text-[0.86em] font-semibold uppercase tracking-[0.04em] text-[var(--ds-grey-medium-05)]",
          "data-[numeric]:text-right",
          className,
        )}
        {...props}
      />
    ),
    td: ({ className, node: _node, style, ...props }) => {
      const numeric = "data-numeric" in props;
      return (
        <td
          style={style}
          className={cn(
            "border-b border-[var(--color-hairline)] px-3.5 py-2.5 align-top [tr:last-child>&]:border-b-0",
            numeric && "text-right tabular-nums whitespace-nowrap",
            className,
          )}
          {...props}
        />
      );
    },
    sup: ({ className, node: _node, ...props }) => (
      <sup
        className={cn("ml-0.5 text-[0.7em] font-semibold", className)}
        {...props}
      />
    ),
    section: ({ className, node: _node, ...props }) => (
      <section
        className={cn(
          className?.includes("footnotes") &&
            "mt-6 border-t border-[var(--color-hairline)] pt-3 text-[0.82em] text-[var(--color-muted-foreground)] [&_h2]:sr-only [&_ol]:space-y-1",
          className,
        )}
        {...props}
      />
    ),
  };
}

/* eslint-enable @typescript-eslint/no-unused-vars */

// Single dollars stay literal: "$20 to $30" in a price answer must not
// turn into a formula. Math is `$$...$$`, inline or on its own lines.
const REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
  remarkCallouts,
];
const REHYPE_PLUGINS: PluggableList = [
  [rehypeKatex, { throwOnError: false, strict: "ignore" }],
  rehypeNumericColumns,
];

export function Markdown({
  children,
  className,
  onCallService,
  onAsk,
  withHeadingIds,
  streaming = false,
}: {
  children: string;
  className?: string;
  // True while the answer is still arriving: unfinished chart and KPI
  // JSON shows a placeholder instead of an error.
  streaming?: boolean;
  onCallService?: () => void;
  // Sends a follow-up question as the next user message. When absent,
  // a questions block renders as plain text.
  onAsk?: (q: string) => void;
  // When true, h2 elements get an id derived from their text content so
  // anchor navigation works (used by the legal pages' table of contents).
  withHeadingIds?: boolean;
}) {
  // Callers pass fresh inline handlers on every render. Rebuilding the
  // renderers for each one would remount the whole answer on every
  // streamed token (images refetch, charts flicker), so the handlers
  // live in refs and the renderers only change when one appears or
  // disappears.
  const callServiceRef = useRef(onCallService);
  const askRef = useRef(onAsk);
  useEffect(() => {
    callServiceRef.current = onCallService;
    askRef.current = onAsk;
  });
  const hasCallService = !!onCallService;
  const hasAsk = !!onAsk;
  const callService = useCallback(() => callServiceRef.current?.(), []);
  const ask = useCallback((q: string) => askRef.current?.(q), []);
  const components = useMemo(
    () =>
      // The refs are read only inside click handlers, never during render.
      // eslint-disable-next-line react-hooks/refs
      buildComponents({
        onCallService: hasCallService ? callService : undefined,
        onAsk: hasAsk ? ask : undefined,
        withHeadingIds,
      }),
    [hasCallService, hasAsk, withHeadingIds, callService, ask],
  );

  return (
    <div
      className={cn(
        "text-[16px] leading-[1.6] text-[var(--color-foreground)] break-words sm:text-[19px] sm:leading-[1.7]",
        "[&_.katex-display]:my-4 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1",
        className,
      )}
    >
      <StreamingContext.Provider value={streaming}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
        urlTransform={(url) =>
          url.startsWith("opti:") ? url : defaultUrlTransform(url)
        }
      >
        {children}
      </ReactMarkdown>
      </StreamingContext.Provider>
    </div>
  );
}
