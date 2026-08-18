// Per-page figure detection for a PDF, used to send the model only the
// pages that actually need a vision pass.
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

export type PageFigureSignal = {
  /** 1-indexed, matching how both PDF readers and the model count pages. */
  page: number;
  /** Raster image paint operations (scans, photos, screenshots). */
  images: number;
  /** Vector path/fill/stroke operations (schematics, drawings, charts). */
  drawOps: number;
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

/**
 * Counts image and vector-drawing operations per page. Returns null if the
 * PDF can't be analysed (corrupt, encrypted, unexpected pdf.js shape) —
 * callers must then fall back to sending the whole document.
 */
export async function analyzePdfFigures(
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
        getOperatorList: () => Promise<{ fnArray: number[] }>;
        cleanup?: () => unknown;
      };
      try {
        const ops = await page.getOperatorList();
        let images = 0;
        let draws = 0;
        for (const fn of ops.fnArray) {
          if (imageOps.has(fn)) images++;
          else if (drawOps.has(fn)) draws++;
        }
        pages.push({ page: n, images, drawOps: draws });
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

/**
 * True when selecting `pages` out of `pageCount` is worth a slice. False
 * when the selection is empty (caller should skip the call entirely) or
 * covers most of the document (no meaningful saving).
 */
export function worthSlicing(pages: number[], pageCount: number): boolean {
  if (pages.length === 0 || pageCount === 0) return false;
  return pages.length / pageCount < WHOLE_DOC_THRESHOLD;
}
