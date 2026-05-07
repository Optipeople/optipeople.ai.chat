import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const components: Components = {
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
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[19px] leading-[1.7] text-[var(--color-foreground)]",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
