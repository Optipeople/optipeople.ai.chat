import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";

// Sentinel href emitted by `remarkServiceButton`. When the link renderer
// sees it, the anchor becomes an inline pill button that calls the same
// handler as the bottom "Tilkald service" button.
const CALL_SERVICE_HREF = "opti:call-service";

// Walks the mdast tree and replaces standalone "service" / "Service" words
// inside plain text with a synthetic `link` node pointing to
// CALL_SERVICE_HREF. Skips text inside existing links and code so we don't
// double-wrap. Word-boundary matching avoids catching compounds like
// "serviceaftale".
function remarkServiceButton() {
  const SKIP = new Set(["code", "inlineCode", "link", "linkReference"]);
  type Node = { type: string; value?: string; children?: Node[] };
  const transform = (node: Node) => {
    if (!node.children) return;
    const out: Node[] = [];
    for (const child of node.children) {
      if (SKIP.has(child.type)) {
        out.push(child);
        continue;
      }
      if (child.type !== "text" || typeof child.value !== "string") {
        transform(child);
        out.push(child);
        continue;
      }
      const value = child.value;
      const regex = /\bservice\b/gi;
      let last = 0;
      let matched = false;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(value)) !== null) {
        matched = true;
        if (m.index > last) {
          out.push({ type: "text", value: value.slice(last, m.index) });
        }
        out.push({
          type: "link",
          // mdast link carries `url` at runtime
          ...({ url: CALL_SERVICE_HREF } as object),
          children: [{ type: "text", value: m[0] }],
        });
        last = m.index + m[0].length;
      }
      if (!matched) {
        out.push(child);
      } else if (last < value.length) {
        out.push({ type: "text", value: value.slice(last) });
      }
    }
    node.children = out;
  };
  return (tree: Node) => transform(tree);
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
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "font-medium text-[var(--color-accent)] underline decoration-[var(--color-accent)]/30 underline-offset-2 hover:decoration-[var(--color-accent)]",
        className,
      )}
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
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
}: {
  children: string;
  className?: string;
  onCallService?: () => void;
}) {
  const components = useMemo<Components>(() => {
    if (!onCallService) return baseComponents;
    return {
      ...baseComponents,
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
  }, [onCallService]);

  const plugins = useMemo(
    () => (onCallService ? [remarkGfm, remarkServiceButton] : [remarkGfm]),
    [onCallService],
  );

  return (
    <div
      className={cn(
        "text-[19px] leading-[1.7] text-[var(--color-foreground)]",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
