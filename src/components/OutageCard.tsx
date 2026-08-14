"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export type OutageInfo = {
  kind: "outage" | "overloaded" | "rate_limit" | "error" | "session";
  title: string;
  statusUrl?: string;
};

export function OutageCard({
  info,
  message,
  onRetry,
  action,
}: {
  info: OutageInfo;
  message: string;
  onRetry?: () => void;
  // Alternative primary action (e.g. "Log in again" on session expiry).
  // Rendered with the same affordance as retry.
  action?: { label: string; onClick: () => void };
}) {
  const tChat = useTranslations("chat");

  return (
    <div
      role="alert"
      className={cn(
        "msg-in flex max-w-[90%] flex-col gap-3 rounded-[6px] border px-4 py-3.5 sm:max-w-[78%] sm:px-5 sm:py-4",
        "border-[var(--color-amber)]/40 bg-[var(--color-amber-soft)]",
        "shadow-[var(--shadow-sm)]",
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-amber)]"
          aria-hidden
        />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-[15px] font-semibold leading-tight text-[var(--color-foreground)] sm:text-[16px]">
            {info.title}
          </div>
          <div className="text-[14px] leading-[1.5] text-[var(--color-foreground)]/85 sm:text-[15px]">
            {message}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-8">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={cn(
              "tap-target inline-flex items-center gap-1.5 rounded-[4px] border px-3 py-1.5 text-[13px] font-medium",
              "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]",
              "transition-colors hover:bg-[var(--color-muted)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {tChat("errorTryAgain")}
          </button>
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className={cn(
              "tap-target inline-flex items-center gap-1.5 rounded-[4px] border px-3 py-1.5 text-[13px] font-medium",
              "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]",
              "transition-colors hover:bg-[var(--color-muted)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          >
            {action.label}
          </button>
        )}
        {info.statusUrl && (
          <a
            href={info.statusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1.5 text-[13px] font-medium",
              "text-[var(--color-foreground)]/80 hover:text-[var(--color-foreground)]",
              "transition-colors hover:bg-[var(--color-amber)]/10",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
            )}
          >
            {tChat("errorCheckStatus")}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}
