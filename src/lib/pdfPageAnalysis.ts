// Per-page figure AND table detection for a PDF, used to send the model
// only the pages that actually need a vision pass.
//
// Why this exists: figure extraction (imageCaption.ts) used to base64 the
// WHOLE document into the request. A 282-page manual with twelve diagrams
// paid for 282 rasterised pages to find those twelve, and vision input
// dominated the AI bill.
//
// The fix is to ask pdf.js what is actually drawn on each page — cheap,
// local, no API call — then slice the PDF down to those pages
// (see pdfSlice.ts).
//
// Vector drawings are the reason this isn't just "count embedded images".
// Vendor technical drawings are frequently pure vector paths with zero
// image XObjects, so an image-only test would silently drop exactly the
// diagrams operators need most. Verified against demo-data: every page of
// 02-technical-drawings.pdf reports zero image XObjects.
//
// The companion signal — which pages lack a usable text layer, i.e. the
// ones OCR is for — comes from pdf-parse's own per-page render in
// pdfText.ts rather than from here. pdf.js's getTextContent() reaches for
// the DOM-only font loader and throws under Node, and pdf-parse already
// walks every page's text anyway.
//
// Every failure path returns null, and callers treat null as "I don't
// know, send the whole document". Degrading to the old, more expensive
// behaviour always beats losing a figure.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// pdf-parse vendors several pdf.js builds and defaults to v1.10.100 (see
// its lib/pdf-parse.js DEFAULT_OPTIONS). We deliberately load the same
// one: it is already resident once pdf-parse has run, and it is the only
// vendored build that works under Node — v2.0.550 reaches for `document`
// in its font loader and throws even with disableFontFace.
const PDFJS_BUILD = "pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js";

// Vector-drawing threshold, RELATIVE to the document's own median page.
//
// An absolute threshold does not work, and this was measured rather than
// guessed. On real Omron manuals the median page already carries 30–400
// drawing operations purely in page furniture — header rules, footer
// lines, ruled tables — so any fixed low threshold selects ~80% of pages
// and saves nothing. Scaling off the median adapts to whatever that
// document's baseline page looks like:
//
//   1316-page Troubleshooting Manual: median 392 → 4x selects ~1% of pages
//   834-page Motion Control Reference: median 123 → 4x selects ~5%
//   686-page EtherNet/IP Manual:       median 132 → 4x selects ~12%
//
// Raise the multiple to spend less and risk missing simpler diagrams;
// lower it to catch more at proportionally more cost.
const DRAW_OPS_MEDIAN_MULTIPLE = 4;

// Floor for the relative threshold, for documents whose median page is
// near-empty (all-scan PDFs, sparse drawing sets) where a multiple of the
// median would otherwise select almost every page.
const DRAW_OPS_FLOOR = 120;

// Hard cap on pages sent in one figure pass. Bounds two things at once:
//
//   Cost — 150 pages of vision input is roughly $1 at Sonnet rates, which
//   is the most any single document should cost to inventory.
//   Correctness — the PDF document API caps a request at 600 pages (100
//   on 200k-context models) and 32 MB. Manuals here run to 1316 pages, so
//   the biggest ones were being rejected outright and silently produced no
//   figures at all. Capping means they now return something.
const MAX_FIGURE_PAGES = 150;

// Slicing stops paying off once most of the document is selected: the
// request is nearly the same size and we have added work and a page-number
// remap for nothing. Past this share, callers send the original buffer.
const WHOLE_DOC_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Table detection (docs/answer-correctness-plan.md fix A)
// ---------------------------------------------------------------------------
//
// A table is detected from its RULES, not from its text. The plan called
// for trying a text-shape heuristic first, but pdf-parse's page renderer
// concatenates text items on the same baseline with NO separator (see
// render_page in pdf-parse/lib/pdf-parse.js), so a row of cells can
// arrive as "BackupOFFONOFFOFF" with no column gap left to measure. The
// column whitespace a text heuristic needs is exactly what is destroyed
// before we could look at it, so geometry is the primary signal here and
// the text heuristic is only an OR-ed fallback for PDFs that do preserve
// spacing.
//
// The grid signature is horizontal rules at several distinct heights,
// optionally crossed by vertical rules, with few curves. That separates a
// ruled table from a schematic, which the figure detector above already
// catches and which is answered by a different prompt.

// A rule has to be longer than this (PDF user-space units, 1/72 inch) to
// count. Filters out cell tick marks and glyph-sized artefacts.
const MIN_RULE_LENGTH = 20;

// Coordinates are rounded to this many units before counting distinct
// rule positions, so a table drawn as many abutting segments per row
// still reports one level per row.
const RULE_LEVEL_ROUNDING = 2;

// Tolerance for calling a segment axis-aligned.
const AXIS_EPSILON = 0.6;

// Thresholds, measured against the demo corpus (numbers are distinct rule
// levels per page):
//
//   prose pages                    h 4-8,   v 2       (border + header/footer)
//   horizontal-rule-only tables    h 13,    v 2
//   ruled tables                   h 15-43, v 5-15
//   vector technical drawings      h 10-12, v 4
//
// Tables on horizontal rules alone are common, so there are two paths in:
// plenty of horizontal rules by themselves, or fewer of them crossed by
// vertical ones.
const MIN_H_LEVELS_ALONE = 12;
const MIN_H_LEVELS_WITH_GRID = 8;
const MIN_V_LEVELS_WITH_GRID = 3;
//
// This detector DELIBERATELY OVER-SELECTS, and the drawing row above is
// why it has to: at 10-12 horizontal levels a vector drawing sits just
// under the densest tables and just over the prose, with no clean gap. The
// asymmetry decides it. Missing a table page leaves the linearization bug
// that gave an operator the wrong DIP switch pin; a false positive costs a
// few cents of vision and gets that page transcribed literally instead,
// which is no worse than the text layer. So we take the false positives
// and bound them with MAX_TABLE_PAGES plus the ingest deadline.
//
// If the vision bill ever justifies tightening this, the next signal to
// add is shared extent: a table's horizontal rules all span roughly the
// same x-range and its vertical rules the same y-range, where a drawing's
// dimension lines do not. That needs per-rule extents rather than just
// positions, and it should be calibrated against real vendor manuals
// rather than the synthetic demo set the numbers above come from.
//
// Note what is NOT a signal here: curves. An earlier version rejected any
// page whose curve count outweighed its rules, on the theory that curves
// mean "drawing". Measured, that threw away real tables: a spec page with
// 40 horizontal and 14 vertical rules also carried 48 curves, all of them
// rounded corners on callout boxes. Curves say nothing about whether the
// page holds a grid.

// Hard cap on pages sent in one table pass, and the reason the cap
// matters more here than for figures: a parameter-list manual can be
// tables end to end, where figures are always a small minority. 60 pages
// is roughly $0.40 of vision input plus its Markdown output on Sonnet.
// Pages over the cap are dropped highest-score-first and logged.
export const MAX_TABLE_PAGES = 60;

export type PageFigureSignal = {
  /** 1-indexed, matching how both PDF readers and the model count pages. */
  page: number;
  /** Raster image paint operations (scans, photos, screenshots). */
  images: number;
  /** Vector path/fill/stroke operations (schematics, drawings, charts). */
  drawOps: number;
  /** Rule geometry, used to tell ruled tables from drawings. */
  grid: PageGridSignal;
};

export type PageGridSignal = {
  /** Distinct heights carrying a horizontal rule. */
  hLevels: number;
  /** Distinct x positions carrying a vertical rule. */
  vLevels: number;
  /** Curve operations, the strongest "this is a drawing" signal. */
  curves: number;
  /** Segments that are neither horizontal nor vertical. */
  diagonals: number;
};

export type PdfFigureAnalysis = {
  pageCount: number;
  pages: PageFigureSignal[];
};

type OpsTable = Record<string, number>;

function opSet(OPS: OpsTable, names: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const n of names) {
    const code = OPS[n];
    if (typeof code === "number") out.add(code);
  }
  return out;
}

const IMAGE_OPS = [
  "paintImageXObject",
  "paintImageXObjectRepeat",
  "paintJpegXObject",
  "paintInlineImageXObject",
  "paintInlineImageXObjectGroup",
  "paintImageMaskXObject",
  "paintImageMaskXObjectRepeat",
] as const;

const DRAW_OPS = [
  "constructPath",
  "fill",
  "eoFill",
  "stroke",
  "closeStroke",
  "fillStroke",
  "eoFillStroke",
  "closeFillStroke",
  "closeEOFillStroke",
  "shadingFill",
] as const;

// Accumulator for one page's rule geometry.
type GridAccumulator = {
  hLevels: Set<number>;
  vLevels: Set<number>;
  curves: number;
  diagonals: number;
};

function newGrid(): GridAccumulator {
  return { hLevels: new Set(), vLevels: new Set(), curves: 0, diagonals: 0 };
}

function level(v: number): number {
  return Math.round(v / RULE_LEVEL_ROUNDING);
}

// Classify one straight segment. Horizontal and vertical rules are
// recorded by position so a row drawn as several abutting segments counts
// once; anything else is a diagonal, which votes against "table".
function addSegment(
  g: GridAccumulator,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dy <= AXIS_EPSILON && dx >= MIN_RULE_LENGTH) {
    g.hLevels.add(level(y1));
  } else if (dx <= AXIS_EPSILON && dy >= MIN_RULE_LENGTH) {
    g.vLevels.add(level(x1));
  } else if (dx >= MIN_RULE_LENGTH || dy >= MIN_RULE_LENGTH) {
    g.diagonals++;
  }
}

/**
 * Decodes one constructPath operator into rule geometry.
 *
 * `args` is `[subOps, coords]`: a list of path sub-operations and a flat
 * coordinate array they consume in order. The consumption pattern per
 * sub-op is copied from the vendored build's own CanvasGraphics
 * implementation, so it stays in step with how pdf.js reads the same
 * data. An unknown sub-op aborts the walk rather than guessing, because
 * a wrong stride desynchronises every coordinate after it.
 */
function decodePath(
  subOps: unknown,
  coords: unknown,
  sub: Record<string, number>,
  g: GridAccumulator,
): void {
  if (!Array.isArray(subOps) || !coords) return;
  const c = coords as ArrayLike<number>;
  let x = 0;
  let y = 0;
  let j = 0;
  const take = (): number => {
    const v = c[j++];
    return typeof v === "number" ? v : 0;
  };
  for (const rawOp of subOps as number[]) {
    const op = rawOp | 0;
    if (op === sub.rectangle) {
      const rx = take();
      const ry = take();
      const w = take();
      const h = take();
      // A table rule is very often drawn as a hairline rectangle rather
      // than a stroked line, so a thin rectangle counts as a rule and a
      // fat one contributes all four of its sides.
      if (Math.abs(h) <= AXIS_EPSILON && Math.abs(w) >= MIN_RULE_LENGTH) {
        g.hLevels.add(level(ry));
      } else if (Math.abs(w) <= AXIS_EPSILON && Math.abs(h) >= MIN_RULE_LENGTH) {
        g.vLevels.add(level(rx));
      } else {
        addSegment(g, rx, ry, rx + w, ry);
        addSegment(g, rx, ry + h, rx + w, ry + h);
        addSegment(g, rx, ry, rx, ry + h);
        addSegment(g, rx + w, ry, rx + w, ry + h);
      }
      x = rx;
      y = ry;
    } else if (op === sub.moveTo) {
      x = take();
      y = take();
    } else if (op === sub.lineTo) {
      const nx = take();
      const ny = take();
      addSegment(g, x, y, nx, ny);
      x = nx;
      y = ny;
    } else if (op === sub.curveTo) {
      j += 4;
      x = take();
      y = take();
      g.curves++;
    } else if (op === sub.curveTo2) {
      j += 2;
      x = take();
      y = take();
      g.curves++;
    } else if (op === sub.curveTo3) {
      x = take();
      y = take();
      j += 2;
      g.curves++;
    } else if (op === sub.closePath) {
      // No coordinates.
    } else {
      // Unknown sub-op: the coordinate stride is no longer known.
      return;
    }
  }
}

/**
 * Counts image and vector-drawing operations per page. Returns null if the
 * PDF can't be analysed (corrupt, encrypted, unexpected pdf.js shape) —
 * callers must then fall back to sending the whole document.
 */
// One walk per buffer, not per caller. Both vision passes now need this
// analysis (figures via imageCaption, tables via pdfText), and on a
// 1316-page manual the operator-list walk is tens of seconds. The ingest
// pipeline memoises its downloaded Buffer, so both callers arrive with the
// same object; a resumed invocation re-downloads and simply misses.
const analysisCache = new WeakMap<object, PdfFigureAnalysis | null>();

export async function analyzePdfFigures(
  buf: Buffer,
): Promise<PdfFigureAnalysis | null> {
  if (analysisCache.has(buf)) return analysisCache.get(buf) ?? null;
  const result = await analyzePdfFiguresUncached(buf);
  analysisCache.set(buf, result);
  return result;
}

async function analyzePdfFiguresUncached(
  buf: Buffer,
): Promise<PdfFigureAnalysis | null> {
  let doc:
    | {
        numPages: number;
        getPage: (n: number) => Promise<unknown>;
        destroy?: () => unknown;
      }
    | null = null;
  try {
    const pdfjs = require(PDFJS_BUILD);
    const OPS: OpsTable | undefined = pdfjs.OPS ?? pdfjs.PDFJS?.OPS;
    const getDocument = pdfjs.getDocument ?? pdfjs.PDFJS?.getDocument;
    if (!OPS || typeof getDocument !== "function") return null;

    if (pdfjs.PDFJS) {
      // These have to be set as GLOBALS, not as getDocument options. This
      // build resolves them through getDefaultSetting(), which reads the
      // PDFJS singleton and ignores per-call params (see `case
      // 'disableFontFace'` in the vendored build). Passing
      // disableFontFace to getDocument looks like it works — the first
      // document succeeds — then the second one throws "document is not
      // defined" from the DOM-only font loader.
      //
      // Note this mutates state shared with pdf-parse, which requires the
      // same build. That is safe and intended: disableFontFace only
      // affects rasterising glyphs to a canvas, which neither we nor
      // pdf-parse (text extraction only) ever do.
      pdfjs.PDFJS.disableFontFace = true;
      pdfjs.PDFJS.disableWorker = true;
      // Errors only. Vendor manuals routinely trip "invalid character in
      // hex string"-class warnings that say nothing useful about a
      // document we are only measuring.
      pdfjs.PDFJS.verbosity = 0;
    }

    const imageOps = opSet(OPS, IMAGE_OPS);
    const drawOps = opSet(OPS, DRAW_OPS);
    const constructPathOp = OPS.constructPath;
    // Path sub-operation codes live in the same OPS table as the top-level
    // operators. Pulled once per document rather than per page.
    const subOps: Record<string, number> = {};
    for (const name of [
      "rectangle",
      "moveTo",
      "lineTo",
      "curveTo",
      "curveTo2",
      "curveTo3",
      "closePath",
    ]) {
      if (typeof OPS[name] === "number") subOps[name] = OPS[name];
    }

    // nativeImageDecoderSupport, unlike disableFontFace, IS read from the
    // per-call params (see the params handling in the vendored build).
    // 'none' keeps pdf.js from handing JPEG streams to the DOM `Image`
    // constructor, which doesn't exist under Node. This one matters more
    // than it looks: real vendor manuals are full of JPEGs, and the throw
    // happens inside pdf.js's own message-handler callback, so it escapes
    // the try/catch here as an unhandled rejection and takes the whole
    // process down rather than degrading to null.
    const task = getDocument({
      data: new Uint8Array(buf),
      disableFontFace: true,
      nativeImageDecoderSupport: "none",
    });
    doc = await (task?.promise ?? task);
    if (!doc || typeof doc.numPages !== "number") return null;

    const pages: PageFigureSignal[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = (await doc.getPage(n)) as {
        getOperatorList: () => Promise<{
          fnArray: number[];
          argsArray: unknown[];
        }>;
        cleanup?: () => unknown;
      };
      try {
        const ops = await page.getOperatorList();
        let images = 0;
        let draws = 0;
        const grid = newGrid();
        for (let k = 0; k < ops.fnArray.length; k++) {
          const fn = ops.fnArray[k];
          if (imageOps.has(fn)) images++;
          else if (drawOps.has(fn)) draws++;
          if (fn === constructPathOp) {
            const args = ops.argsArray?.[k] as unknown[] | undefined;
            if (Array.isArray(args)) {
              decodePath(args[0], args[1], subOps, grid);
            }
          }
        }
        pages.push({
          page: n,
          images,
          drawOps: draws,
          grid: {
            hLevels: grid.hLevels.size,
            vLevels: grid.vLevels.size,
            curves: grid.curves,
            diagonals: grid.diagonals,
          },
        });
      } finally {
        page.cleanup?.();
      }
    }
    return { pageCount: doc.numPages, pages };
  } catch (err) {
    console.warn(
      "analyzePdfFigures: falling back to whole-document vision:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    try {
      doc?.destroy?.();
    } catch {
      // Best effort — a failed teardown must not mask a good result.
    }
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Ranking for the MAX_FIGURE_PAGES cap. An embedded raster image is the
// strongest evidence a page holds a figure, so those outrank every
// vector-only page; within each group, denser geometry first.
function figureScore(p: PageFigureSignal): number {
  return (p.images > 0 ? 1e9 : 0) + p.drawOps;
}

/**
 * Pages carrying a raster image, or vector geometry well above this
 * document's own baseline. Ascending page order, at most
 * MAX_FIGURE_PAGES entries (the most figure-like win the cap).
 */
export function figurePages(analysis: PdfFigureAnalysis): number[] {
  const threshold = Math.max(
    DRAW_OPS_FLOOR,
    median(analysis.pages.map((p) => p.drawOps)) * DRAW_OPS_MEDIAN_MULTIPLE,
  );
  const candidates = analysis.pages.filter(
    (p) => p.images > 0 || p.drawOps >= threshold,
  );
  if (candidates.length <= MAX_FIGURE_PAGES) {
    return candidates.map((p) => p.page);
  }
  return candidates
    .slice()
    .sort((a, b) => figureScore(b) - figureScore(a))
    .slice(0, MAX_FIGURE_PAGES)
    .map((p) => p.page)
    .sort((a, b) => a - b);
}

// Does this page's geometry look like a ruled table?
function looksLikeTable(p: PageFigureSignal): boolean {
  const { hLevels, vLevels, diagonals } = p.grid;
  const rules = hLevels + vLevels;
  if (rules === 0) return false;
  // A table's lines are essentially all axis-aligned. A page whose
  // straight geometry is mostly diagonal is a schematic, and the figure
  // pass is the right one for it.
  if (diagonals > rules) return false;
  if (hLevels >= MIN_H_LEVELS_ALONE) return true;
  return hLevels >= MIN_H_LEVELS_WITH_GRID && vLevels >= MIN_V_LEVELS_WITH_GRID;
}

// Ranking for the MAX_TABLE_PAGES cap: denser grids first, since a page
// with more rule levels holds more rows at risk of being linearized.
function tableScore(p: PageFigureSignal): number {
  return p.grid.hLevels * 2 + p.grid.vLevels;
}

// Fallback signal for PDFs whose text layer DOES preserve column
// whitespace. Cheap enough to run unconditionally, and it costs nothing
// when it never fires.
const COLUMN_GAP_RE = /\S[ \t]{2,}\S+[ \t]{2,}\S/;
const MIN_COLUMNAR_LINES = 4;

function looksColumnar(pageText: string | undefined): boolean {
  if (!pageText) return false;
  let hits = 0;
  for (const line of pageText.split("\n")) {
    if (COLUMN_GAP_RE.test(line)) {
      hits++;
      if (hits >= MIN_COLUMNAR_LINES) return true;
    }
  }
  return false;
}

/**
 * Pages that carry a ruled table (geometry), or whose extracted text
 * still shows column whitespace (`pageTexts[i]` is page `i + 1`).
 * Ascending page order, at most MAX_TABLE_PAGES entries. The second
 * return value reports how many candidates the cap dropped so callers
 * can log it rather than silently under-covering a document.
 */
export function tablePages(
  analysis: PdfFigureAnalysis,
  pageTexts?: string[],
): { pages: number[]; dropped: number } {
  const candidates = analysis.pages.filter(
    (p) => looksLikeTable(p) || looksColumnar(pageTexts?.[p.page - 1]),
  );
  if (candidates.length <= MAX_TABLE_PAGES) {
    return { pages: candidates.map((p) => p.page), dropped: 0 };
  }
  return {
    pages: candidates
      .slice()
      .sort((a, b) => tableScore(b) - tableScore(a))
      .slice(0, MAX_TABLE_PAGES)
      .map((p) => p.page)
      .sort((a, b) => a - b),
    dropped: candidates.length - MAX_TABLE_PAGES,
  };
}

/**
 * True when selecting `pages` out of `pageCount` is worth a slice. False
 * when the selection is empty (caller should skip the call entirely) or
 * covers most of the document (no meaningful saving).
 */
export function worthSlicing(pages: number[], pageCount: number): boolean {
  if (pages.length === 0 || pageCount === 0) return false;
  return pages.length / pageCount < WHOLE_DOC_THRESHOLD;
}
