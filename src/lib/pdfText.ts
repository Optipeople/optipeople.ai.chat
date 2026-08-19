// PDF text extraction with automatic OCR fallback and a table repair pass.
//
// Flow:
//   1. pdf-parse reads the embedded text layer, page by page. Fast, free,
//      works for 90 % of vendor manuals.
//   2. If the result looks empty (image-only PDFs, scans, exports where
//      someone rasterised the text) the buffer is handed to Claude with
//      vision. Claude extracts text in reading order including content
//      that's rendered as images. Slower and costs API tokens, but the
//      typical manual is a single-digit-dollar ingest.
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
// Threshold tuning: a real manual page usually carries hundreds of
// characters. Anything below the thresholds below is almost certainly an
// image-only PDF, so fall back to OCR.

import { createRequire } from "node:module";
import Anthropic from "@anthropic-ai/sdk";
import { pageMarker } from "./chunking";
import { analyzePdfFigures, tablePages } from "./pdfPageAnalysis";
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

// A real manual page typically carries 1000+ characters once you strip
// whitespace; under ~400/page is the tell that the page is mostly
// images, scans, or rasterised text. Earlier thresholds (30/page) were
// way too generous: page numbers and headers alone could trip past
// them, leaving image-heavy PDFs ingesting as empty chunks.
const MIN_CHARS_PER_PAGE = 400;
const ABSOLUTE_MIN = 500;

// "pdf-parse+tables" means the text layer was used, then the table-bearing
// pages were replaced by a vision pass. Kept distinct from "pdf-parse" so
// the admin UI can tell which documents predate the table repair and
// therefore still need a reprocess.
export type PdfExtractionSource =
  | "pdf-parse"
  | "pdf-parse+tables"
  | "claude-ocr";

export type PdfExtractionForce = "ocr" | "pdf-parse";

export type PdfExtractionResult = {
  /** Page-marker-bearing text. Feed straight to chunkText. */
  text: string;
  pageCount: number;
  source: PdfExtractionSource;
  /** How many pages the table pass rewrote. 0 when it did not run. */
  tablePagesRewritten: number;
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

async function extractWithClaude(
  buf: Buffer,
  usage?: UsageAttribution,
): Promise<string> {
  const anthropic = new Anthropic();
  const base64 = buf.toString("base64");

  // The SDK forces streaming for any request whose worst-case duration
  // could exceed 10 minutes, and a 32k-output OCR pass over a multi-page
  // PDF qualifies. We use streaming and just await the final message.
  const stream = anthropic.messages.stream({
    model: OCR_MODEL,
    max_tokens: 32000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64,
            },
          },
          {
            type: "text",
            text:
              "Extract every word of text from this PDF, including content rendered as images. " +
              "Preserve reading order. Insert a blank line between sections so the structure stays readable. " +
              "Do not summarise, paraphrase, or describe visuals. Output the literal text only. " +
              "If a page is purely a diagram with no readable text, write a short bracketed note " +
              "like [Diagram: tool change sequence] in its place.\n\n" +
              `Before each page's text, output a line containing only ${pageMarker(
                1,
              )}, where the number is that page's 1-based position in this PDF. ` +
              "The first page is 1. Ignore any page number printed on the page itself.\n\n" +
              TABLE_RULES,
          },
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
  return parts.join("");
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

// Replaces the text of every page the table pass re-read. Pages it could
// not process keep their pdf-parse text, which is the pre-fix behaviour.
async function repairTables(
  buf: Buffer,
  parsed: ParsedPdf,
  opts: {
    usage?: UsageAttribution;
    deadlineAt?: number | null;
    onPhaseStart?: ExtractPhaseHook;
  },
): Promise<{ pages: string[]; rewritten: number }> {
  const analysis = await analyzePdfFigures(buf);
  if (!analysis) return { pages: parsed.pages, rewritten: 0 };

  const { pages: candidates, dropped } = tablePages(analysis, parsed.pages);
  if (candidates.length === 0) return { pages: parsed.pages, rewritten: 0 };
  if (dropped > 0) {
    // Never silent: an under-covered document looks identical to a fully
    // covered one from the outside.
    console.warn(
      `[pdfText] ${candidates.length + dropped} table pages detected, ` +
        `capped at ${candidates.length} (${dropped} not re-read)`,
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
    usage?: UsageAttribution;
    /**
     * ms epoch after which the table pass stops starting batches. Pass
     * null (or omit) to run to completion: the CLI has no platform time
     * limit, a Vercel function does.
     */
    deadlineAt?: number | null;
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

  const ocr = async (
    parsed: ParsedPdf,
    reason: string,
  ): Promise<PdfExtractionResult> => {
    console.log(`[pdfText] ${reason}`);
    await phase("claude-ocr");
    const raw = await extractWithClaude(buf, opts.usage);
    const cleaned = clean(raw);
    return {
      // The OCR prompt emits the sentinels itself. If the model skipped
      // them the text simply has no page provenance, exactly as before.
      text: cleaned,
      pageCount: parsed.pageCount,
      source: "claude-ocr",
      tablePagesRewritten: 0,
    };
  };

  const fromTextLayer = async (
    parsed: ParsedPdf,
  ): Promise<PdfExtractionResult> => {
    if (opts.skipTables) {
      await phase("pdf-parse");
      return {
        text: clean(joinPagesWithMarkers(parsed.pages)),
        pageCount: parsed.pageCount,
        source: "pdf-parse",
        tablePagesRewritten: 0,
      };
    }
    await phase("pdf-parse");
    const { pages, rewritten } = await repairTables(buf, parsed, {
      usage: opts.usage,
      deadlineAt: opts.deadlineAt,
      onPhaseStart: opts.onPhaseStart,
    });
    return {
      text: clean(joinPagesWithMarkers(pages)),
      pageCount: parsed.pageCount,
      source: rewritten > 0 ? "pdf-parse+tables" : "pdf-parse",
      tablePagesRewritten: rewritten,
    };
  };

  const parsed = await parsePerPage(buf);
  const joined = clean(parsed.pages.join("\n\n"));

  if (opts.force === "pdf-parse") return fromTextLayer(parsed);
  if (opts.force === "ocr") {
    return ocr(
      parsed,
      `forced Claude OCR (${joined.length} chars / ${parsed.pageCount} pages from pdf-parse)`,
    );
  }

  const charsPerPage =
    parsed.pageCount > 0 ? joined.length / parsed.pageCount : 0;
  const tooThin =
    joined.length < ABSOLUTE_MIN || charsPerPage < MIN_CHARS_PER_PAGE;

  if (!tooThin) return fromTextLayer(parsed);

  return ocr(
    parsed,
    `low text yield (${joined.length} chars / ${parsed.pageCount} pages, ` +
      `${charsPerPage.toFixed(0)}/page), falling back to Claude OCR`,
  );
}
