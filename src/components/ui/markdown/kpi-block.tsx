"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * KpiBlock renders a ```kpi fence emitted by the model.
 *
 * Fence body (JSON), either an array of items or { "items": [...] }:
 * {
 *   "label": string,
 *   "value": string | number,
 *   "unit"?: string,
 *   "delta"?: string,                       // e.g. "+4.2% vs last week"
 *   "trend"?: "up" | "down" | "flat",
 *   "status"?: "good" | "warn" | "bad" | "neutral",
 *   "hint"?: string
 * }
 *
 * While the answer streams the JSON is incomplete, so a parse failure renders a
 * skeleton. Once streaming ends, a parse failure or JSON with the wrong shape
 * falls back to the raw source.
 */

export type KpiTrend = "up" | "down" | "flat";
export type KpiStatus = "good" | "warn" | "bad" | "neutral";

export type KpiItem = {
  label: string;
  value: string | number;
  unit?: string;
  delta?: string;
  trend?: KpiTrend;
  status?: KpiStatus;
  hint?: string;
};

type ParseResult =
  | { status: "pending" }
  | { status: "invalid" }
  | { status: "ok"; items: KpiItem[] };

const TRENDS: KpiTrend[] = ["up", "down", "flat"];
const STATUSES: KpiStatus[] = ["good", "warn", "bad", "neutral"];

function str(v: unknown) {
  return typeof v === "string" && v.trim() ? v : undefined;
}

export function parseKpiItems(source: string, streaming = false): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { status: streaming ? "pending" : "invalid" };
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : null;
  if (!list || list.length === 0) return { status: "invalid" };

  const items: KpiItem[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") return { status: "invalid" };
    const o = it as Record<string, unknown>;
    const label = str(o.label);
    const value =
      typeof o.value === "number" && Number.isFinite(o.value)
        ? o.value
        : typeof o.value === "string"
          ? o.value
          : undefined;
    if (!label || value === undefined) return { status: "invalid" };
    items.push({
      label,
      value,
      unit: str(o.unit),
      delta: str(o.delta),
      trend: TRENDS.includes(o.trend as KpiTrend) ? (o.trend as KpiTrend) : undefined,
      status: STATUSES.includes(o.status as KpiStatus) ? (o.status as KpiStatus) : undefined,
      hint: str(o.hint),
    });
  }
  return { status: "ok", items };
}

type Formats = { full: Intl.NumberFormat; compact: Intl.NumberFormat };

/* Keyed by locale so server and client build identical formatters. */
const formatCache = new Map<string, Formats>();

function getFormats(locale: string): Formats {
  let f = formatCache.get(locale);
  if (!f) {
    f = {
      full: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
      compact: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    };
    formatCache.set(locale, f);
  }
  return f;
}

/** Auto-compact large numbers (1,284 / 12.9K / 4.2M); strings pass through as written. */
function formatKpiValue(fmt: Formats, v: string | number) {
  if (typeof v === "string") return v;
  return Math.abs(v) >= 10000 ? fmt.compact.format(v) : fmt.full.format(v);
}

/** Falls back to the delta's sign when the model gives no explicit trend. */
function resolveTrend(item: KpiItem): KpiTrend | undefined {
  if (item.trend) return item.trend;
  if (!item.delta) return undefined;
  const d = item.delta.trim();
  if (/^[+↑]/.test(d)) return "up";
  if (/^[-−↓]/.test(d)) return "down";
  if (/^(0|±0)([.,]0+)?\s*%?/.test(d)) return "flat";
  return undefined;
}

const STATUS_ICON_COLOR: Record<KpiStatus, string> = {
  good: "text-[var(--ds-green)]",
  warn: "text-[var(--ds-orange-darkest)]",
  bad: "text-[var(--ds-red)]",
  neutral: "text-[var(--color-muted-foreground)]",
};

const STATUS_LABEL: Record<KpiStatus, string> = {
  good: "Good",
  warn: "Warning",
  bad: "Critical",
  neutral: "",
};

const FRAME =
  "rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-surface)]";

function gridCols(n: number) {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-2";
  if (n === 3) return "grid-cols-2 sm:grid-cols-3";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";
}

function KpiTile({ item, fmt }: { item: KpiItem; fmt: Formats }) {
  const trend = resolveTrend(item);
  const status = item.status ?? "neutral";
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : trend === "flat" ? Minus : null;

  return (
    <div className={cn(FRAME, "flex min-w-0 flex-col gap-1 px-3.5 py-3")}>
      <div className="truncate text-[11.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-muted-foreground)]" title={item.label}>
        {item.label}
      </div>
      <div className="flex min-w-0 items-baseline gap-1 text-[var(--color-foreground)]">
        <span className="truncate text-[24px] font-semibold leading-tight tracking-tight">
          {formatKpiValue(fmt, item.value)}
        </span>
        {item.unit ? (
          <span className="shrink-0 text-[13px] font-medium text-[var(--color-muted-foreground)]">{item.unit}</span>
        ) : null}
      </div>
      {item.delta || Icon ? (
        <div className="flex min-w-0 items-center gap-1 text-[12.5px] text-[var(--ds-grey-medium-06)]">
          {Icon ? <Icon aria-hidden className={cn("h-3.5 w-3.5 shrink-0", STATUS_ICON_COLOR[status])} strokeWidth={2.25} /> : null}
          {STATUS_LABEL[status] ? <span className="sr-only">{STATUS_LABEL[status]}:</span> : null}
          {item.delta ? <span className="truncate tabular-nums">{item.delta}</span> : null}
        </div>
      ) : null}
      {item.hint ? (
        <div className="text-[11.5px] leading-snug text-[var(--color-muted-foreground)]">{item.hint}</div>
      ) : null}
    </div>
  );
}

export function KpiSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(FRAME, "my-3 p-3", className)} aria-busy="true" aria-label="Loading figures">
      <div className="h-[88px] animate-pulse rounded-[var(--radius-xs)] bg-[var(--color-muted)]" />
    </div>
  );
}

export function KpiBlock({
  source,
  className,
  streaming = false,
}: {
  source: string;
  className?: string;
  streaming?: boolean;
}) {
  const parsed = React.useMemo(() => parseKpiItems(source, streaming), [source, streaming]);
  const locale = useLocale();
  const fmt = React.useMemo(() => getFormats(locale), [locale]);

  if (parsed.status === "pending") return <KpiSkeleton className={className} />;
  if (parsed.status === "invalid") {
    return (
      <pre className="my-3 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-subtle)] p-3 font-mono text-[12.5px] leading-[1.55] text-[var(--color-muted-foreground)]">
        {source}
      </pre>
    );
  }

  return (
    <div className={cn("not-prose my-3 grid gap-2", gridCols(parsed.items.length), className)}>
      {parsed.items.map((item, i) => (
        <KpiTile key={i} item={item} fmt={fmt} />
      ))}
    </div>
  );
}

export default KpiBlock;
