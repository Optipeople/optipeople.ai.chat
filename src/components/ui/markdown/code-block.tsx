"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { highlight } from "sugar-high";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

/**
 * Fenced code block for chat answers: a header bar with the language label
 * and a copy button, then a horizontally scrolling, syntax highlighted body.
 *
 * Highlighting uses sugar-high, which escapes its input and returns spans
 * coloured through the `--sh-*` CSS variables defined below.
 */

const PLAIN_LANGUAGES = new Set(["", "text", "plain", "plaintext", "txt"]);

// Token colours drawn from the design tokens in globals.css.
const SYNTAX_VARS = {
  "--sh-class": "var(--ds-midnight-green)",
  "--sh-identifier": "var(--ds-grey-dark-09)",
  "--sh-sign": "var(--ds-grey-medium-04)",
  "--sh-property": "var(--ds-blue-primary)",
  "--sh-entity": "var(--ds-blue-primary)",
  "--sh-jsxliterals": "var(--ds-grey-medium-06)",
  "--sh-string": "#2e8a3a",
  "--sh-keyword": "var(--ds-red)",
  "--sh-comment": "var(--ds-grey-medium-04)",
} as React.CSSProperties;

export function CodeBlock({
  language,
  code,
}: {
  language?: string;
  code: string;
}) {
  const tChat = useTranslations("chat");
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const lang = (language ?? "").trim().toLowerCase();
  const isPlain = PLAIN_LANGUAGES.has(lang);
  // react-markdown hands over the fence content with a trailing newline.
  const source = code.replace(/\n$/, "");
  const html = React.useMemo(
    () => (isPlain ? null : highlight(source)),
    [isPlain, source],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can fail on insecure contexts. The code stays selectable.
    }
  }

  const label = copied ? tChat("copied") : tChat("copy");

  return (
    <div
      className="my-3 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--ds-grey-light-01)]"
      style={SYNTAX_VARS}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-hairline)] py-0.5 pl-3 pr-1">
        <span className="font-mono text-[11px] lowercase text-[var(--ds-grey-medium-04)]">
          {lang || "text"}
        </span>
        <div className="flex items-center gap-1">
          {copied && (
            <span
              aria-live="polite"
              className="text-[11px] text-[var(--ds-grey-medium-04)]"
            >
              {label}
            </span>
          )}
          <IconButton
            onClick={() => void copy()}
            title={label}
            aria-label={label}
            className={cn(copied && "text-emerald-600 hover:text-emerald-600")}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </IconButton>
        </div>
      </div>
      <pre className="m-0 overflow-x-auto bg-transparent px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-[var(--ds-grey-dark-09)]">
        {html !== null ? (
          <code
            className="whitespace-pre"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <code className="whitespace-pre">{source}</code>
        )}
      </pre>
    </div>
  );
}
