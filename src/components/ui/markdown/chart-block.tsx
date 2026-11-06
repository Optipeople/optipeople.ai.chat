"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";

/*
 * ChartBlock renders a ```chart fence emitted by the model.
 *
 * Fence body (JSON):
 * {
 *   "type": "bar" | "line" | "area" | "pie",
 *   "title"?: string,
 *   "unit"?: string,
 *   "x": string[],                         // category labels (slice labels for pie)
 *   "series": [{ "name": string, "data": number[] }],
 *   "stacked"?: boolean                    // bar and area only
 * }
 *
 * While the answer streams the JSON is incomplete, so a parse failure renders a
 * skeleton. Once streaming ends, a parse failure or JSON with the wrong shape
 * falls back to the raw source.
 */

type ChartType = "bar" | "line" | "area" | "pie";

type Series = { name: string; data: (number | null)[] };

export type ChartSpec = {
  type: ChartType;
  title?: string;
  unit?: string;
  x: string[];
  series: Series[];
  stacked?: boolean;
};

/*
 * Categorical order, derived from the design tokens and validated with the
 * dataviz palette checker against the white surface (lightness band, chroma
 * floor, CVD and normal-vision separation all pass). The brand teal is a more
 * saturated step of --ds-midnight-green so it does not read as gray; purple is
 * the one added hue so a sixth series never repeats a color.
 * Orange and green sit below 3:1 contrast, so every chart keeps a legend
 * (multi-series), tooltips and a screen-reader data table.
 */
export const CHART_PALETTE = [
  "#008c82", // brand teal (from --ds-midnight-green)
  "var(--ds-orange-darkest)",
  "var(--ds-blue-primary)",
  "var(--ds-red)",
  "var(--ds-green)",
  "#8a5aa8",
] as const;

const MAX_SERIES = CHART_PALETTE.length;
const OTHER_COLOR = "var(--ds-grey-light-03)";

const SURFACE = "var(--color-surface)";
const GRID = "var(--ds-grey-light-02)";
const AXIS_TEXT = "var(--color-muted-foreground)";

const FRAME =
  "my-3 rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4";

type Formats = {
  number: Intl.NumberFormat;
  compact: Intl.NumberFormat;
  percent: Intl.NumberFormat;
};

/* Keyed by locale so server and client build identical formatters. */
const formatCache = new Map<string, Formats>();

function getFormats(locale: string): Formats {
  let f = formatCache.get(locale);
  if (!f) {
    f = {
      number: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
      compact: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
      percent: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
    };
    formatCache.set(locale, f);
  }
  return f;
}

function formatValue(fmt: Formats, v: number, unit?: string) {
  const s = fmt.number.format(v);
  return unit ? `${s} ${unit}` : s;
}

/* ---------- parsing ---------- */

type ParseResult =
  | { status: "pending" }
  | { status: "invalid" }
  | { status: "ok"; spec: ChartSpec };

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[\s,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseChartSpec(source: string, streaming = false): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { status: streaming ? "pending" : "invalid" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "invalid" };
  const o = raw as Record<string, unknown>;

  const type = o.type;
  if (type !== "bar" && type !== "line" && type !== "area" && type !== "pie") {
    return { status: "invalid" };
  }
  if (!Array.isArray(o.x) || o.x.length === 0) return { status: "invalid" };
  const x = o.x.map((l) => (l == null ? "" : String(l)));

  if (!Array.isArray(o.series) || o.series.length === 0) return { status: "invalid" };
  const series: Series[] = [];
  for (const [i, s] of o.series.entries()) {
    if (!s || typeof s !== "object" || !Array.isArray((s as { data?: unknown }).data)) {
      return { status: "invalid" };
    }
    const rec = s as { name?: unknown; data: unknown[] };
    const data = x.map((_, j) => toNumber(rec.data[j]));
    if (data.every((d) => d === null)) return { status: "invalid" };
    series.push({
      name: typeof rec.name === "string" && rec.name ? rec.name : `Series ${i + 1}`,
      data,
    });
  }

  return {
    status: "ok",
    spec: {
      type,
      title: typeof o.title === "string" ? o.title : undefined,
      unit: typeof o.unit === "string" && o.unit ? o.unit : undefined,
      x,
      series: series.slice(0, MAX_SERIES),
      stacked: o.stacked === true,
    },
  };
}

/* ---------- scale helpers ---------- */

function niceStep(range: number, targetTicks: number) {
  const rough = range / Math.max(1, targetTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

function niceTicks(min: number, max: number, target = 4) {
  if (min === max) {
    if (max === 0) max = 1;
    else if (max > 0) min = 0;
    else max = 0;
  }
  const step = niceStep(max - min, target);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo, hi, ticks };
}

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/** Rough text width at a given font size, good enough for layout decisions. */
function textWidth(s: string, size: number) {
  return s.length * size * 0.56;
}

/** Bar path with a rounded data-end and a square baseline end. */
function barPath(x: number, y0: number, y1: number, w: number, r: number) {
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const rr = Math.min(r, w / 2, h);
  if (y1 < y0) {
    // grows up, round the top
    return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`;
  }
  // grows down, round the bottom
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
}

/** Measures an element's width. A callback ref, so it attaches whenever the node mounts. */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = React.useState<T | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!el) return;
    // ResizeObserver reports the initial size on observe, so no sync read is needed.
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/* ---------- pieces ---------- */

type TooltipRow = { color: string; label: string; value: string };
type TooltipState = { x: number; y: number; title: string; rows: TooltipRow[] } | null;

function ChartTooltip({ state, width }: { state: TooltipState; width: number }) {
  if (!state) return null;
  const flip = state.x > width * 0.6;
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute z-10 min-w-[120px] max-w-[240px] rounded-[var(--radius-xs)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 py-2 text-[12px] leading-[1.4] shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
      style={{
        left: state.x,
        top: state.y,
        transform: `translate(${flip ? "calc(-100% - 12px)" : "12px"}, -50%)`,
      }}
    >
      <div className="mb-1 font-semibold text-[var(--color-foreground)]">{state.title}</div>
      {state.rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-[var(--color-muted-foreground)]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="min-w-0 flex-1 truncate">{r.label}</span>
          <span className="font-medium tabular-nums text-[var(--color-foreground)]">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; detail?: string }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--color-muted-foreground)]">
      {items.map((it, i) => (
        <li key={i} className="flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: it.color }} />
          <span className="truncate">{it.label}</span>
          {it.detail ? (
            <span className="tabular-nums text-[var(--color-foreground)]">{it.detail}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DataTable({ spec, fmt }: { spec: ChartSpec; fmt: Formats }) {
  return (
    <table className="sr-only">
      {spec.title ? <caption>{spec.title}</caption> : null}
      <thead>
        <tr>
          <th scope="col" />
          {spec.series.map((s, i) => (
            <th key={i} scope="col">
              {s.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {spec.x.map((label, j) => (
          <tr key={j}>
            <th scope="row">{label}</th>
            {spec.series.map((s, i) => (
              <td key={i}>{s.data[j] == null ? "" : formatValue(fmt, s.data[j] as number, spec.unit)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- cartesian (bar / line / area) ---------- */

const PLOT_H = 220;
const FONT = 11;

function CartesianChart({ spec, width, fmt }: { spec: ChartSpec; width: number; fmt: Formats }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const { x: labels, series, unit, type } = spec;
  const n = labels.length;
  const stacked = spec.stacked === true && type !== "line" && series.length > 1;

  // Value extent, using cumulative sums when stacked.
  const stackTops = React.useMemo(() => {
    if (!stacked) return null;
    return labels.map((_, j) => {
      let pos = 0;
      let neg = 0;
      return series.map((s) => {
        const v = s.data[j] ?? 0;
        if (v >= 0) {
          const from = pos;
          pos += v;
          return [from, pos] as const;
        }
        const from = neg;
        neg += v;
        return [from, neg] as const;
      });
    });
  }, [stacked, labels, series]);

  let min = 0;
  let max = 0;
  if (stackTops) {
    for (const col of stackTops) for (const [a, b] of col) {
      min = Math.min(min, a, b);
      max = Math.max(max, a, b);
    }
  } else {
    const all = series.flatMap((s) => s.data.filter((d): d is number => d !== null));
    min = Math.min(...all);
    max = Math.max(...all);
    // Bars and areas need a zero baseline; lines may float.
    if (type !== "line") {
      min = Math.min(0, min);
      max = Math.max(0, max);
    }
  }
  const { lo, hi, ticks } = niceTicks(min, max, 4);
  const compact = Math.max(Math.abs(lo), Math.abs(hi)) >= 10000;
  const tickLabel = (v: number) => (compact ? fmt.compact.format(v) : fmt.number.format(v));

  // Layout
  const yLabelW = Math.max(...ticks.map((t) => textWidth(tickLabel(t), FONT)));
  const left = Math.ceil(yLabelW) + 10;
  const right = 8;
  const top = unit ? 18 : 8;
  const plotW = Math.max(40, width - left - right);
  const band = plotW / n;

  const maxLabelLen = Math.max(...labels.map((l) => l.length));
  const fullLabelW = textWidth(labels.reduce((a, b) => (a.length >= b.length ? a : b), ""), FONT);
  const rotate = fullLabelW > band - 6;
  const truncLen = rotate ? 16 : maxLabelLen;
  const labelEvery = rotate ? Math.max(1, Math.ceil((FONT + 4) / band)) : 1;
  const bottom = rotate
    ? Math.ceil(Math.min(truncLen, maxLabelLen) * FONT * 0.56 * Math.sin(Math.PI / 4)) + 18
    : 22;

  const height = top + PLOT_H + bottom;
  const yScale = (v: number) => top + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;
  const xCenter = (j: number) => left + band * (j + 0.5);
  const y0 = yScale(Math.max(lo, Math.min(0, hi)));

  const colorOf = (i: number) => CHART_PALETTE[i % CHART_PALETTE.length];

  // Bars
  const k = series.length;
  const GAP = 2;
  const barW = stacked
    ? Math.min(24, band * 0.6)
    : Math.max(2, Math.min(24, (band * 0.72 - GAP * (k - 1)) / k));
  const groupW = stacked ? barW : barW * k + GAP * (k - 1);

  const marks: React.ReactNode[] = [];

  if (type === "bar") {
    labels.forEach((_, j) => {
      const gx = xCenter(j) - groupW / 2;
      if (stackTops) {
        const col = stackTops[j];
        // Topmost non-zero segment on each side gets the rounded end.
        let lastPos = -1;
        let lastNeg = -1;
        col.forEach(([a, b], i) => {
          if (b > a) lastPos = i;
          if (b < a) lastNeg = i;
        });
        col.forEach(([a, b], i) => {
          if (a === b) return;
          const isEnd = i === lastPos || i === lastNeg;
          // 2px surface gap between stacked segments.
          const ya = yScale(a) + (a === 0 ? 0 : b > a ? -GAP / 2 : GAP / 2);
          const yb = yScale(b) + (isEnd ? 0 : b > a ? GAP / 2 : -GAP / 2);
          marks.push(
            <path
              key={`${j}-${i}`}
              d={barPath(gx, ya, yb, barW, isEnd ? 4 : 0)}
              fill={colorOf(i)}
              opacity={hover === null || hover === j ? 1 : 0.45}
            />,
          );
        });
      } else {
        series.forEach((s, i) => {
          const v = s.data[j];
          if (v == null) return;
          marks.push(
            <path
              key={`${j}-${i}`}
              d={barPath(gx + i * (barW + GAP), y0, yScale(v), barW, 4)}
              fill={colorOf(i)}
              opacity={hover === null || hover === j ? 1 : 0.45}
            />,
          );
        });
      }
    });
  } else {
    // line / area
    series.forEach((s, i) => {
      const color = colorOf(i);
      const pts: { x: number; y: number; base: number }[][] = [[]];
      s.data.forEach((v, j) => {
        if (v == null) {
          if (pts[pts.length - 1].length) pts.push([]);
          return;
        }
        const st = stackTops?.[j][i];
        const yv = st ? yScale(st[1]) : yScale(v);
        const base = st ? yScale(st[0]) : y0;
        pts[pts.length - 1].push({ x: xCenter(j), y: yv, base });
      });
      pts.forEach((seg, si) => {
        if (!seg.length) return;
        const line = seg.map((p, pi) => `${pi ? "L" : "M"}${p.x},${p.y}`).join("");
        if (type === "area" && seg.length > 1) {
          const back = [...seg]
            .reverse()
            .map((p) => `L${p.x},${p.base}`)
            .join("");
          marks.push(
            <path key={`a-${i}-${si}`} d={`${line}${back}Z`} fill={color} fillOpacity={0.1} />,
          );
        }
        marks.push(
          <path
            key={`l-${i}-${si}`}
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />,
        );
        // Lone points (one value between gaps) still need a visible mark.
        if (seg.length === 1) {
          marks.push(
            <circle key={`p-${i}-${si}`} cx={seg[0].x} cy={seg[0].y} r={4} fill={color} stroke={SURFACE} strokeWidth={2} />,
          );
        }
      });
      // End dot on the last value.
      const lastIdx = s.data.findLastIndex((d) => d !== null);
      if (lastIdx >= 0 && hover === null) {
        const st = stackTops?.[lastIdx][i];
        marks.push(
          <circle
            key={`e-${i}`}
            cx={xCenter(lastIdx)}
            cy={st ? yScale(st[1]) : yScale(s.data[lastIdx] as number)}
            r={4}
            fill={color}
            stroke={SURFACE}
            strokeWidth={2}
          />,
        );
      }
    });
    if (hover !== null) {
      marks.push(
        <line
          key="crosshair"
          x1={xCenter(hover)}
          x2={xCenter(hover)}
          y1={top}
          y2={top + PLOT_H}
          stroke="var(--ds-grey-light-03)"
          strokeWidth={1}
        />,
      );
      series.forEach((s, i) => {
        const v = s.data[hover];
        if (v == null) return;
        const st = stackTops?.[hover][i];
        marks.push(
          <circle
            key={`h-${i}`}
            cx={xCenter(hover)}
            cy={st ? yScale(st[1]) : yScale(v)}
            r={4}
            fill={colorOf(i)}
            stroke={SURFACE}
            strokeWidth={2}
          />,
        );
      });
    }
  }

  const tooltip: TooltipState =
    hover === null
      ? null
      : {
          x: xCenter(hover),
          y: top + PLOT_H / 2,
          title: labels[hover],
          rows: series
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => s.data[hover] != null)
            .map(({ s, i }) => ({
              color: colorOf(i),
              label: s.name,
              value: formatValue(fmt, s.data[hover] as number, unit),
            })),
        };

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={spec.title ?? "Chart"}
        className="block overflow-visible"
      >
        {/* gridlines and y ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + plotW} y1={yScale(t)} y2={yScale(t)} stroke={GRID} strokeWidth={1} />
            <text
              x={left - 8}
              y={yScale(t)}
              dy="0.35em"
              textAnchor="end"
              fontSize={FONT}
              fill={AXIS_TEXT}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {tickLabel(t)}
            </text>
          </g>
        ))}
        {unit ? (
          <text x={0} y={8} textAnchor="start" fontSize={FONT} fill={AXIS_TEXT}>
            {unit}
          </text>
        ) : null}
        {/* zero baseline, a touch stronger than the grid */}
        <line x1={left} x2={left + plotW} y1={y0} y2={y0} stroke="var(--ds-grey-light-03)" strokeWidth={1} />

        {marks}

        {/* x labels */}
        {labels.map((l, j) => {
          if (j % labelEvery !== 0) return null;
          const shown = truncate(l, truncLen);
          const ty = top + PLOT_H + 14;
          return (
            <text
              key={j}
              x={xCenter(j)}
              y={ty}
              fontSize={FONT}
              fill={AXIS_TEXT}
              textAnchor={rotate ? "end" : "middle"}
              transform={rotate ? `rotate(-45 ${xCenter(j)} ${ty})` : undefined}
            >
              {shown !== l ? <title>{l}</title> : null}
              {shown}
            </text>
          );
        })}

        {/* hit targets, one full-height column per category */}
        {labels.map((_, j) => (
          <rect
            key={`hit-${j}`}
            x={left + band * j}
            y={top}
            width={band}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(j)}
            onMouseMove={() => setHover(j)}
            onTouchStart={() => setHover(j)}
          />
        ))}
      </svg>
      <ChartTooltip state={tooltip} width={width} />
    </div>
  );
}

/* ---------- pie ---------- */

const MAX_SLICES = 6;

function buildArcs<T extends { value: number }>(
  slices: T[],
  total: number,
  cx: number,
  cy: number,
  r: number,
) {
  let angle = -Math.PI / 2;
  return slices.map((s) => {
    const sweep = total > 0 ? (s.value / total) * Math.PI * 2 : 0;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const mid = (a0 + a1) / 2;
    let d: string;
    if (sweep >= Math.PI * 2 - 1e-6) {
      d = `M${cx},${cy - r}A${r},${r} 0 1 1 ${cx - 0.01},${cy - r}Z`;
    } else {
      const large = sweep > Math.PI ? 1 : 0;
      d = `M${cx},${cy}L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}Z`;
    }
    return { ...s, d, mid };
  });
}

function PieChart({ spec, width, fmt }: { spec: ChartSpec; width: number; fmt: Formats }) {
  const [hover, setHover] = React.useState<number | null>(null);

  const slices = React.useMemo(() => {
    const raw = spec.x
      .map((label, j) => ({ label, value: spec.series[0].data[j] ?? 0 }))
      .filter((s) => s.value > 0);
    // Fixed palette order by input position; past six, fold the rest into Other.
    let items = raw.map((s, i) => ({ ...s, color: CHART_PALETTE[i] as string }));
    if (raw.length > MAX_SLICES) {
      const head = raw.slice(0, MAX_SLICES - 1).map((s, i) => ({ ...s, color: CHART_PALETTE[i] as string }));
      const rest = raw.slice(MAX_SLICES - 1).reduce((a, s) => a + s.value, 0);
      items = [...head, { label: "Other", value: rest, color: OTHER_COLOR }];
    }
    return items;
  }, [spec]);

  const total = slices.reduce((a, s) => a + s.value, 0);
  const size = Math.min(220, Math.max(140, width * 0.5));
  const r = size / 2;
  const cx = r;
  const cy = r;

  const arcs = buildArcs(slices, total, cx, cy, r);

  const tooltip: TooltipState =
    hover === null || !arcs[hover]
      ? null
      : {
          x: cx + r * 0.6 * Math.cos(arcs[hover].mid),
          y: cy + r * 0.6 * Math.sin(arcs[hover].mid),
          title: arcs[hover].label,
          rows: [
            {
              color: arcs[hover].color,
              label: fmt.percent.format(arcs[hover].value / total),
              value: formatValue(fmt, arcs[hover].value, spec.unit),
            },
          ],
        };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0 self-center" style={{ width: size, height: size }} onMouseLeave={() => setHover(null)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={spec.title ?? "Pie chart"} className="block overflow-visible">
          {arcs.map((a, i) => (
            <path
              key={i}
              d={a.d}
              fill={a.color}
              stroke={SURFACE}
              strokeWidth={2}
              strokeLinejoin="round"
              opacity={hover === null || hover === i ? 1 : 0.45}
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            />
          ))}
        </svg>
        <ChartTooltip state={tooltip} width={size} />
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
        {arcs.map((a, i) => (
          <li
            key={i}
            className="flex min-w-0 items-center gap-2"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: a.color }} />
            <span className="min-w-0 flex-1 truncate text-[var(--color-muted-foreground)]">{a.label}</span>
            <span className="tabular-nums text-[var(--color-foreground)]">{formatValue(fmt, a.value, spec.unit)}</span>
            <span className="w-12 text-right tabular-nums text-[var(--color-muted-foreground)]">
              {fmt.percent.format(total ? a.value / total : 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- public ---------- */

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(FRAME, className)} aria-busy="true" aria-label="Loading chart">
      <div className="h-[180px] animate-pulse rounded-[var(--radius-xs)] bg-[var(--color-muted)]" />
    </div>
  );
}

function ChartFallback({ source }: { source: string }) {
  return (
    <pre className="my-3 overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-subtle)] p-3 font-mono text-[12.5px] leading-[1.55] text-[var(--color-muted-foreground)]">
      {source}
    </pre>
  );
}

export function ChartBlock({
  source,
  className,
  streaming = false,
}: {
  source: string;
  className?: string;
  streaming?: boolean;
}) {
  const parsed = React.useMemo(() => parseChartSpec(source, streaming), [source, streaming]);
  const locale = useLocale();
  const fmt = React.useMemo(() => getFormats(locale), [locale]);
  const [ref, width] = useWidth<HTMLDivElement>();

  if (parsed.status === "pending") return <ChartSkeleton className={className} />;
  if (parsed.status === "invalid") return <ChartFallback source={source} />;

  const { spec } = parsed;
  const showLegend = spec.type !== "pie" && spec.series.length > 1;

  return (
    <figure className={cn(FRAME, "not-prose", className)}>
      {spec.title ? (
        <figcaption className="mb-3 text-[15px] font-semibold leading-snug text-[var(--color-foreground)]">
          {spec.title}
        </figcaption>
      ) : null}
      {showLegend ? (
        <Legend items={spec.series.map((s, i) => ({ label: s.name, color: CHART_PALETTE[i] }))} />
      ) : null}
      <div ref={ref} className="w-full min-w-0">
        {width > 0 ? (
          spec.type === "pie" ? (
            <PieChart spec={spec} width={width} fmt={fmt} />
          ) : (
            <CartesianChart spec={spec} width={width} fmt={fmt} />
          )
        ) : (
          <div className="h-[180px]" />
        )}
      </div>
      <DataTable spec={spec} fmt={fmt} />
    </figure>
  );
}

export default ChartBlock;
