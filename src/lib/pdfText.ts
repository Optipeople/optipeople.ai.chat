// PDF text extraction with automatic OCR fallback and a table repair pass.
//
// Flow:
//   1. pdf-parse reads the embedded text layer, page by page. Fast, free,
//      works for 90 % of vendor manuals.
//   2. If the result looks empty (image-only PDFs, scans, exports where
//      someone rasterised the text) the pages are handed to Claude with
//      vision, a slice at a time. Claude extracts text in reading order
//      including content that's rendered as images. Slower and costs API
//      tokens, but the typical manual is a single-digit-dollar ingest.
//   2b. Mixed documents: on the pdf-parse path, any individual page that
//      carries an embedded image but almost no text (a scanned insert, a
//      wiring diagram with rasterised labels) is OCR'd on its own and its
//      empty text replaced. The whole-document fallback in 2 cannot see
//      these: a 200-page manual with 5 scanned pages has a healthy average.
//   3. On the pdf-parse path, the pages that carry tables are re-read with
//      vision and their text is replaced (pdfTables.ts). pdf-parse
//      linearizes a table into a stream of orphaned cells, which is how an
//      operator was given the wrong DIP switch pin on 2026-08-19. See
//      docs/answer-correctness-plan.md.
//
// Every path emits `<<<page:N>>>` sentinels ahead of each page's text.
// The chunker consumes them into kb_chunks.page_from / page_to and strips
// them before anything is stored (chunking.ts).
//
// OCR runs in slices (OCR_SLICE_PAGES) rather than one request over the
// whole buffer. One request was the cause of two production failures: the
// output hit max_tokens on long scans and the tail of the manual silently
// vanished, and a single request over a 100-page scan ran past the
// function's time limit with no way to checkpoint. Slices bound both: a
// truncated slice is split and retried, and the pass can stop between
// slices, hand back what it has (`incomplete`) and let the caller persist
// it so the next invocation continues where this one stopped.
//
// Threshold tuning: a real manual page usually carries hundreds of
// characters. Anything below the thresholds below is almost certainly an
// image-only PDF, so fall back to OCR.

import { createRequire } from "node:module";
import Anthropic from "@anthropic-ai/sdk";
import { pageMarker, splitPageSegments } from "./chunking";
import { analyzePdfFigures, tablePages } from "./pdfPageAnalysis";
import { slicePdfPages } from "./pdfSlice";
import { extractPageTables } from "./pdfTables";
import {
  fromAnthropicUsage,
  recordUsage,
  type UsageAttribution,
} from "./usage";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

// Sonnet handles complex layouts (tables, multi-column technical docs)
// noticeably better than Haiku, and worth the extra cost on the rare paths
// where OCR actually runs.
const OCR_MODEL = "claude-sonnet-4-6";

const OCR_MAX_TOKENS = 32000;

// Pages per OCR request. Ten dense scanned pages come back as roughly
// 10–15k output tokens, which at Sonnet's output rate is 1–3 minutes: the
// most a single un-checkpointable step may take inside a 300 s function
// with the hard budget in front of it. Larger slices were where the
// max_tokens truncations came from.
const OCR_SLICE_PAGES = 10;

// A slice whose output still hits max_tokens is split in half and
// retried, down to this size. Below it a page is so dense that no slice
// size helps, and we fail loudly instead of guessing.
const OCR_MIN_SPLIT_PAGES = 3;

// Headroom a slice needs in front of the caller's deadline before it may
// start. A slice cannot be interrupted once the request is out, so
// starting one with a few seconds left guarantees a blown budget.
const OCR_SLICE_TIME_RESERVE_MS = 45_000;

// A real manual page typically carries 1000+ characters once you strip
// whitespace; under ~400/page is the tell that the page is mostly
// images, scans, or rasterised text. Earlier thresholds (30/page) were
// way too generous: page numbers and headers alone could trip past
// them, leaving image-heavy PDFs ingesting as empty chunks.
const MIN_CHARS_PER_PAGE = 400;
const ABSOLUTE_MIN = 500;

// Per-page gate for mixed documents: a page with an embedded raster image
// and fewer characters than this is treated as a scan and OCR'd alone.
// Headers and footers alone are typically 20–60 characters, so 100 leaves
// room for them without letting a real half-empty page through.
const OCR_PAGE_MIN_CHARS = 100;

// "pdf-parse+tables" means the text layer was used, then the table-bearing
// pages were replaced by a vision pass. Kept distinct from "pdf-parse" so
// the admin UI can tell which documents predate the table repair and
// therefore still need a reprocess.
export type PdfExtractionSource =
  | "pdf-parse"
  | "pdf-parse+tables"
  | "claude-ocr";

export type PdfExtractionForce = "ocr" | "pdf-parse";

/**
 * OCR progress that survives across invocations. Keys are original
 * 1-indexed page numbers (as strings, JSON-friendly), values the OCR'd
 * page text. The ingest pipeline persists this next to the PDF when the
 * pass runs out of time and hands it back on the next call.
 */
export type OcrCheckpoint = {
  pages: Record<string, string>;
};

export type PdfExtractionResult = {
  /** Page-marker-bearing text. Feed straight to chunkText. */
  text: string;
  pageCount: number;
  source: PdfExtractionSource;
  /** How many pages the table pass rewrote. 0 when it did not run. */
  tablePagesRewritten: number;
  /**
   * Set when the OCR pass stopped at the deadline before covering every
   * page it needed. Carries everything OCR'd so far (including the pages
   * passed in via opts.ocrCheckpoint) plus the pages still to do. `text`
   * is NOT complete when this is set: persist the checkpoint and call
   * again with it.
   */
  incomplete?: OcrCheckpoint & { pending: number[] };
};

function clean(raw: string): string {
  return raw.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Joins per-page text into one document, each page led by its sentinel.
// Empty pages still get a marker: a page that yielded no text is real
// information (it is a full-page image), and dropping it would shift every
// later page's provenance.
function joinPagesWithMarkers(pages: string[]): string {
  return pages
    .map((text, i) => `${pageMarker(i + 1)}\n${text.trim()}`)
    .join("\n\n");
}

// The same table-fidelity rules the dedicated table pass uses, shared with
// OCR because a scanned table loses its column binding exactly as badly as
// a linearized one.
const TABLE_RULES = `Tables:
- Reproduce every table as a GitHub-flavored Markdown table.
- Reproduce the header cells EXACTLY as printed, in the printed left-to-right order. Never sort, renumber, or normalise them. If the header row reads "4 3 2 1", your header row must read "| 4 | 3 | 2 | 1 |". Descending and otherwise unusual column orders are common in hardware manuals and they are load-bearing: an operator sets a physical switch from them.
- If a cell spans several columns or rows, repeat its value in each cell it spans.
- Keep the table's caption or number line on the line immediately above the table.
- Copy cell values verbatim, including ON, OFF, dashes, blanks and footnote markers. Do not add units, convert values, or reorder rows.`;

function buildOcrPrompt(pageCount: number): string {
  return (
    `This PDF holds ${pageCount} page(s) taken from a larger technical manual. ` +
    "Extract every word of text from it, including content rendered as images. " +
    "Preserve reading order. Insert a blank line between sections so the structure stays readable. " +
    "Do not summarise, paraphrase, or describe visuals. Output the literal text only. " +
    "If a page is purely a diagram with no readable text, write a short bracketed note " +
    "like [Diagram: tool change sequence] in its place, so that every page produces output.\n\n" +
    `Before each page's text, output a line containing only ${pageMarker(1)}, ` +
    "where the number is that page's 1-based position in THIS PDF. " +
    `The first page is 1, the last is ${pageCount}. Ignore any page number printed on the page itself. ` +
    "Output nothing before the first marker.\n\n" +
    TABLE_RULES
  );
}

type OcrSliceOutput = {
  text: string;
  stopReason: string | null;
};

async function ocrSliceOnce(
  pdf: Buffer,
  pageCount: number,
  usage?: UsageAttribution,
): Promise<OcrSliceOutput> {
  const anthropic = new Anthropic();

  // The SDK forces streaming for any request whose worst-case duration
  // could exceed 10 minutes, and a 32k-output OCR pass qualifies. We use
  // streaming and just await the final message.
  const stream = anthropic.messages.stream({
    model: OCR_MODEL,
    max_tokens: OCR_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdf.toString("base64"),
            },
          },
          { type: "text", text: buildOcrPrompt(pageCount) },
        ],
      },
    ],
  });

  const final = await stream.finalMessage();

  if (usage) {
    await recordUsage({
      ...usage,
      provider: "anthropic",
      model: OCR_MODEL,
      operation: "pdf_ocr",
      ...fromAnthropicUsage(final.usage),
    });
  }

  const parts: string[] = [];
  for (const block of final.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return { text: parts.join(""), stopReason: final.stop_reason ?? null };
}

// Maps a slice's OCR output onto original page numbers.
//
// Valid output has exactly one marker per slice page, in ascending order
// (1, 2, …, n). Anything else — a skipped page, a repeated marker, the
// printed page number copied instead of the position — would anchor text
// to the wrong page, and page provenance is what operators are sent to.
// `valid` false tells the caller to retry; the returned map is then the
// sequential fallback: segments assigned to slice pages in order, which is
// right whenever the model got the count right and the numbering wrong.
function mapOcrSegments(
  text: string,
  originalPages: number[],
): { byPage: Map<number, string>; valid: boolean } {
  const n = originalPages.length;
  const segments = splitPageSegments(text);
  const numbered = segments.filter((s) => s.page !== null);

  let valid = numbered.length === n;
  for (let i = 0; valid && i < numbered.length; i++) {
    if (numbered[i].page !== i + 1) valid = false;
  }

  const byPage = new Map<number, string>();
  if (valid) {
    for (const seg of numbered) {
      byPage.set(originalPages[(seg.page as number) - 1], seg.text.trim());
    }
    return { byPage, valid: true };
  }

  // Sequential fallback. A page-less preamble only counts as a page when
  // the model emitted no markers at all; otherwise it is stray commentary.
  const ordered = numbered.length > 0 ? numbered : segments;
  for (let i = 0; i < ordered.length; i++) {
    const target = originalPages[Math.min(i, n - 1)];
    const body = ordered[i].text.trim();
    if (!body) continue;
    const prev = byPage.get(target);
    byPage.set(target, prev ? `${prev}\n\n${body}` : body);
  }
  return { byPage, valid: false };
}

type OcrPassResult = {
  /** Original 1-indexed page → OCR'd text, checkpoint pages included. */
  byPage: Map<number, string>;
  /** Pages not reached before the deadline, ascending. Empty = complete. */
  pending: number[];
};

/**
 * OCRs `pages` (original 1-indexed, ascending) in slices, honouring the
 * deadline between slices. Never starts a slice with less than
 * OCR_SLICE_TIME_RESERVE_MS left; when out of time it returns what it has
 * plus the pending list, so the caller can checkpoint and continue.
 *
 * Throws only on a failure that a retry will not fix (a slice at the
 * minimum size still exceeding max_tokens, or a PDF that cannot be sliced
 * or read at all).
 */
async function ocrPagesSliced(
  buf: Buffer,
  pageCount: number,
  pages: number[],
  opts: {
    usage?: UsageAttribution;
    deadlineAt?: number | null;
    checkpoint?: OcrCheckpoint | null;
    onProgress?: (donePages: number, totalPages: number) => void | Promise<void>;
  },
): Promise<OcrPassResult> {
  const byPage = new Map<number, string>();
  for (const [k, v] of Object.entries(opts.checkpoint?.pages ?? {})) {
    const p = Number.parseInt(k, 10);
    if (Number.isInteger(p) && p >= 1 && p <= pageCount && typeof v === "string") {
      byPage.set(p, v);
    }
  }

  const todo = pages.filter((p) => !byPage.has(p));
  const queue: number[][] = [];
  for (let i = 0; i < todo.length; i += OCR_SLICE_PAGES) {
    queue.push(todo.slice(i, i + OCR_SLICE_PAGES));
  }

  const report = async () => {
    if (!opts.onProgress) return;
    try {
      const done = pages.filter((p) => byPage.has(p)).length;
      await opts.onProgress(done, pages.length);
    } catch {
      // Progress reporting must never abort the pass.
    }
  };
  await report();

  while (queue.length > 0) {
    if (
      opts.deadlineAt !== null &&
      opts.deadlineAt !== undefined &&
      Date.now() >= opts.deadlineAt - OCR_SLICE_TIME_RESERVE_MS
    ) {
      return { byPage, pending: queue.flat() };
    }
    const slice = queue.shift() as number[];

    // Slicing is mandatory: we are writing text back to specific pages, so
    // without a page mapping there is nothing safe to splice. The one
    // exception is a slice that IS the whole document, where the original
    // buffer maps 1:1.
    let payload: Buffer;
    let originalPages: number[];
    const sliced = await slicePdfPages(buf, slice);
    if (sliced) {
      payload = sliced.buffer;
      originalPages = sliced.originalPages;
    } else if (slice.length === pageCount) {
      payload = buf;
      originalPages = slice;
    } else {
      throw new Error(
        `OCR could not slice pages ${slice[0]}–${slice[slice.length - 1]} out of the PDF`,
      );
    }

    let out = await ocrSliceOnce(payload, originalPages.length, opts.usage);

    if (out.stopReason === "max_tokens") {
      if (slice.length > OCR_MIN_SPLIT_PAGES) {
        // Too much text for one request. Halve and put both halves back at
        // the front so the pass keeps moving through the document in order.
        const mid = Math.ceil(slice.length / 2);
        console.warn(
          `[pdfText] OCR hit max_tokens on ${slice.length} pages ` +
            `(${slice[0]}–${slice[slice.length - 1]}); retrying as ${mid} + ${slice.length - mid}`,
        );
        queue.unshift(slice.slice(0, mid), slice.slice(mid));
        continue;
      }
      throw new Error(
        `OCR output exceeded the token limit on pages ${slice.join(", ")} even at the minimum slice size`,
      );
    }

    let mapped = mapOcrSegments(out.text, originalPages);
    if (!mapped.valid) {
      console.warn(
        `[pdfText] OCR page markers did not match the slice (pages ${originalPages.join(",")}); re-running once`,
      );
      out = await ocrSliceOnce(payload, originalPages.length, opts.usage);
      if (out.stopReason !== "max_tokens") {
        const retry = mapOcrSegments(out.text, originalPages);
        if (retry.valid || retry.byPage.size >= mapped.byPage.size) {
          mapped = retry;
        }
      }
      if (!mapped.valid) {
        console.warn(
          `[pdfText] OCR markers still off after retry; assigning pages sequentially`,
        );
      }
    }

    for (const p of originalPages) {
      // Every requested page gets an entry, even an empty one: it marks
      // the page as done so a checkpointed continuation does not redo it.
      byPage.set(p, mapped.byPage.get(p) ?? "");
    }
    await report();
  }

  return { byPage, pending: [] };
}

function checkpointFrom(byPage: Map<number, string>): OcrCheckpoint {
  const pages: Record<string, string> = {};
  for (const [p, text] of byPage) pages[String(p)] = text;
  return { pages };
}

// Per-page text extraction, replicating pdf-parse's own default renderer
// so the aggregate text is unchanged from before page provenance existed.
// The only difference is that we keep the pages apart instead of letting
// pdf-parse concatenate them.
//
// Note this is where a table's column whitespace disappears: items sharing
// a baseline are concatenated with no separator, which is why table
// detection cannot rely on the text layer (see pdfPageAnalysis.ts).
type PdfTextItem = { str: string; transform: number[] };

async function renderPage(pageData: {
  getTextContent: (opts: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }) => Promise<{ items: PdfTextItem[] }>;
}): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });
  let lastY: number | undefined;
  let text = "";
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || !lastY) {
      text += item.str;
    } else {
      text += `\n${item.str}`;
    }
    lastY = item.transform[5];
  }
  return text;
}

type ParsedPdf = { pages: string[]; pageCount: number };

async function parsePerPage(buf: Buffer): Promise<ParsedPdf> {
  const pages: string[] = [];
  const record = (page: number, text: string) => {
    // Index by the page's own number rather than push order. pdf-parse
    // walks pages sequentially, but it also swallows a failed page with
    // an empty string WITHOUT calling us, and a push would then shift
    // every subsequent page's provenance by one.
    pages[page - 1] = text;
  };
  const { numpages } = (await pdfParse(buf, {
    pagerender: async (pageData: {
      pageNumber?: number;
      pageIndex?: number;
      getTextContent: Parameters<typeof renderPage>[0]["getTextContent"];
    }) => {
      const page =
        pageData.pageNumber ??
        (typeof pageData.pageIndex === "number" ? pageData.pageIndex + 1 : 0);
      try {
        const text = await renderPage(pageData);
        if (page > 0) record(page, text);
        return text;
      } catch (err) {
        console.warn(
          `[pdfText] page ${page} render failed:`,
          err instanceof Error ? err.message : err,
        );
        if (page > 0) record(page, "");
        return "";
      }
    },
  })) as { numpages: number };

  // Fill holes left by pages pdf-parse could not render at all.
  for (let i = 0; i < numpages; i++) {
    if (typeof pages[i] !== "string") pages[i] = "";
  }
  return { pages: pages.slice(0, numpages), pageCount: numpages };
}

// Pages that look like scans inside an otherwise text-bearing PDF: an
// embedded raster image and almost no text layer. Returns [] when the
// page analysis is unavailable, because without it "no text" alone is
// ambiguous (a genuinely blank page would cost a vision call for nothing).
async function scannedPages(buf: Buffer, parsed: ParsedPdf): Promise<number[]> {
  const analysis = await analyzePdfFigures(buf);
  if (!analysis) return [];
  const out: number[] = [];
  for (const signal of analysis.pages) {
    const text = parsed.pages[signal.page - 1];
    if (typeof text !== "string") continue;
    if (signal.images > 0 && text.trim().length < OCR_PAGE_MIN_CHARS) {
      out.push(signal.page);
    }
  }
  return out.sort((a, b) => a - b);
}

// Replaces the text of every page the table pass re-read. Pages it could
// not process keep their pdf-parse text, which is the pre-fix behaviour.
// `exclude` holds pages another vision pass already rewrote this run.
async function repairTables(
  buf: Buffer,
  parsed: ParsedPdf,
  opts: {
    usage?: UsageAttribution;
    deadlineAt?: number | null;
    onPhaseStart?: ExtractPhaseHook;
    exclude?: Set<number>;
  },
): Promise<{ pages: string[]; rewritten: number }> {
  const analysis = await analyzePdfFigures(buf);
  if (!analysis) return { pages: parsed.pages, rewritten: 0 };

  const selected = tablePages(analysis, parsed.pages);
  const candidates = selected.pages.filter((p) => !opts.exclude?.has(p));
  if (candidates.length === 0) return { pages: parsed.pages, rewritten: 0 };
  if (selected.dropped > 0) {
    // Never silent: an under-covered document looks identical to a fully
    // covered one from the outside.
    console.warn(
      `[pdfText] ${selected.pages.length + selected.dropped} table pages detected, ` +
        `capped at ${selected.pages.length} (${selected.dropped} not re-read)`,
    );
  }

  if (opts.onPhaseStart) {
    try {
      await opts.onPhaseStart("pdf-parse+tables");
    } catch (err) {
      console.warn("extractPdfText: onPhaseStart failed:", err);
    }
  }

  const extraction = await extractPageTables(buf, candidates, {
    usage: opts.usage,
    deadlineAt: opts.deadlineAt,
  });

  const pages = [...parsed.pages];
  for (const [page, text] of extraction.byPage) {
    if (page >= 1 && page <= pages.length) pages[page - 1] = text;
  }
  if (extraction.missing.length > 0) {
    console.warn(
      `[pdfText] table pass returned nothing for ${extraction.missing.length} page(s)` +
        (extraction.truncated ? " (stopped early: out of time)" : ""),
    );
  }
  return { pages, rewritten: extraction.byPage.size };
}

export type ExtractPhaseHook = (
  phase: PdfExtractionSource,
) => void | Promise<void>;

export async function extractPdfText(
  buf: Buffer,
  opts: {
    force?: PdfExtractionForce;
    onPhaseStart?: ExtractPhaseHook;
    /** OCR progress in pages, for the admin progress bar. */
    onOcrProgress?: (donePages: number, totalPages: number) => void | Promise<void>;
    usage?: UsageAttribution;
    /**
     * ms epoch after which no further vision request is started. Pass
     * null (or omit) to run to completion: the CLI has no platform time
     * limit, a Vercel function does. OCR that runs out of time returns
     * `incomplete` instead of throwing.
     */
    deadlineAt?: number | null;
    /** Pages already OCR'd by an earlier invocation (see `incomplete`). */
    ocrCheckpoint?: OcrCheckpoint | null;
    /** Skip the table repair pass entirely (cheaper, pre-fix behaviour). */
    skipTables?: boolean;
  } = {},
): Promise<PdfExtractionResult> {
  const phase = async (p: PdfExtractionSource) => {
    if (!opts.onPhaseStart) return;
    try {
      await opts.onPhaseStart(p);
    } catch (err) {
      console.warn("extractPdfText: onPhaseStart failed:", err);
    }
  };

  const parsed = await parsePerPage(buf);
  const allPages = Array.from({ length: parsed.pageCount }, (_, i) => i + 1);

  const runOcr = (pages: number[]) =>
    ocrPagesSliced(buf, parsed.pageCount, pages, {
      usage: opts.usage,
      deadlineAt: opts.deadlineAt,
      checkpoint: opts.ocrCheckpoint,
      onProgress: opts.onOcrProgress,
    });

  // Pages not OCR'd keep their pdf-parse text (only relevant on the mixed
  // path; a whole-document OCR overwrites every page).
  const splice = (byPage: Map<number, string>): string[] => {
    const pages = [...parsed.pages];
    for (const [p, text] of byPage) {
      if (p >= 1 && p <= pages.length) pages[p - 1] = text;
    }
    return pages;
  };

  const incompleteResult = (
    pass: OcrPassResult,
    source: PdfExtractionSource,
  ): PdfExtractionResult => ({
    text: clean(joinPagesWithMarkers(splice(pass.byPage))),
    pageCount: parsed.pageCount,
    source,
    tablePagesRewritten: 0,
    incomplete: { ...checkpointFrom(pass.byPage), pending: pass.pending },
  });

  const ocrWholeDocument = async (reason: string): Promise<PdfExtractionResult> => {
    console.log(`[pdfText] ${reason}`);
    await phase("claude-ocr");
    const pass = await runOcr(allPages);
    if (pass.pending.length > 0) return incompleteResult(pass, "claude-ocr");
    return {
      text: clean(joinPagesWithMarkers(splice(pass.byPage))),
      pageCount: parsed.pageCount,
      source: "claude-ocr",
      tablePagesRewritten: 0,
    };
  };

  const fromTextLayer = async (): Promise<PdfExtractionResult> => {
    await phase("pdf-parse");
    let pages = parsed.pages;
    const ocrd = new Set<number>();

    // 2b. Mixed documents: scanned pages inside a text PDF. Runs before the
    // table pass because it recovers text that is otherwise entirely
    // missing, where the table pass only improves text we already have.
    const scanned = await scannedPages(buf, parsed);
    if (scanned.length > 0) {
      console.log(
        `[pdfText] ${scanned.length} page(s) look scanned (image, <${OCR_PAGE_MIN_CHARS} chars); OCR'ing them`,
      );
      await phase("claude-ocr");
      const pass = await runOcr(scanned);
      if (pass.pending.length > 0) return incompleteResult(pass, "pdf-parse");
      pages = splice(pass.byPage);
      for (const p of pass.byPage.keys()) ocrd.add(p);
    }

    if (opts.skipTables) {
      return {
        text: clean(joinPagesWithMarkers(pages)),
        pageCount: parsed.pageCount,
        source: "pdf-parse",
        tablePagesRewritten: 0,
      };
    }
    const repaired = await repairTables(buf, { pages, pageCount: parsed.pageCount }, {
      usage: opts.usage,
      deadlineAt: opts.deadlineAt,
      onPhaseStart: opts.onPhaseStart,
      exclude: ocrd,
    });
    return {
      text: clean(joinPagesWithMarkers(repaired.pages)),
      pageCount: parsed.pageCount,
      source: repaired.rewritten > 0 ? "pdf-parse+tables" : "pdf-parse",
      tablePagesRewritten: repaired.rewritten,
    };
  };

  const joined = clean(parsed.pages.join("\n\n"));

  if (opts.force === "pdf-parse") return fromTextLayer();
  if (opts.force === "ocr") {
    return ocrWholeDocument(
      `forced Claude OCR (${joined.length} chars / ${parsed.pageCount} pages from pdf-parse)`,
    );
  }

  const charsPerPage =
    parsed.pageCount > 0 ? joined.length / parsed.pageCount : 0;
  const tooThin =
    joined.length < ABSOLUTE_MIN || charsPerPage < MIN_CHARS_PER_PAGE;

  if (!tooThin) return fromTextLayer();

  return ocrWholeDocument(
    `low text yield (${joined.length} chars / ${parsed.pageCount} pages, ` +
      `${charsPerPage.toFixed(0)}/page), falling back to Claude OCR`,
  );
}
