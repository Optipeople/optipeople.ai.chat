// Table-faithful re-extraction of the pages that carry tables.
//
// Why this exists (docs/answer-correctness-plan.md fix A): pdf-parse
// flattens a table into a linear text stream. The header row collapses to
// a bare line and the value rows become separate lines, so nothing binds a
// cell to its column any more. On 2026-08-19 that cost an operator the
// correct DIP switch position: the OMRON NX502 manual prints its switch
// columns in DESCENDING order (4, 3, 2, 1), and once linearized the model
// read the row left to right as 1, 2, 3, 4 and named the wrong pin.
//
// So the pages that carry tables are re-read by a vision model that can
// see the grid, and their text is replaced. Every other page stays on the
// free deterministic path: this is a targeted repair, not a second OCR of
// the whole manual.
//
// The single most important line in the prompt below is the one that
// forbids normalising the column order. A model asked to "transcribe the
// table" will helpfully sort `4 3 2 1` into `1 2 3 4` and reintroduce the
// exact bug one layer further down.

import Anthropic from "@anthropic-ai/sdk";
import { pageMarker, splitPageSegments } from "./chunking";
import { slicePdfPages, toOriginalPage } from "./pdfSlice";
import {
  fromAnthropicUsage,
  recordUsage,
  type UsageAttribution,
} from "./usage";

// Same tier as OCR and figure extraction. Table transcription is a
// layout-reading task, which is where Sonnet is already known to beat
// Haiku by a wide margin, and Opus buys nothing on transcription.
const TABLE_MODEL = "claude-sonnet-4-6";

// Pages per request. Small batches cost slightly more per page in prompt
// overhead but bound three things that matter more: the output-token
// ceiling (a dense table page can run past 2k output tokens), how much
// work is lost when one request fails, and how coarsely the ingest
// deadline can be honoured.
const TABLE_BATCH_PAGES = 10;

const MAX_TOKENS = 32000;

// Headroom left in front of the caller's deadline. A batch takes tens of
// seconds, so checking "is there time left" is not enough: a batch started
// with 5 seconds to go still runs for a minute and blows through the hard
// ingest budget, which fails the whole document. Better to leave the last
// pages on their pdf-parse text (logged) than to lose the ingest.
const BATCH_TIME_RESERVE_MS = 60_000;

const PROMPT_TAIL = `Table rules, which are the point of this request:
- Reproduce every table as a GitHub-flavored Markdown table.
- Reproduce the header cells EXACTLY as printed, in the printed left-to-right order. Never sort, renumber, or normalise them. If the header row reads "4 3 2 1", your header row must read "| 4 | 3 | 2 | 1 |". Descending and otherwise unusual column orders are common in hardware manuals and they are load-bearing: an operator sets a physical switch from them.
- If a cell spans several columns or rows, repeat its value in each cell it spans.
- Keep the table's caption or number line (e.g. "Table 3-2 DIP switch settings") on the line immediately above the table.
- Copy cell values verbatim, including ON, OFF, dashes, blanks and footnote markers. Do not add units, do not convert values, do not reorder rows, do not summarise.

Everything else on the page: output the text literally, in reading order, including running headers and footers. Do not summarise, paraphrase, or describe visuals. If a region is purely a diagram with no readable text, write a short bracketed note like [Diagram: tool change sequence] in its place.

Output nothing but the page markers and the page text. No preamble, no commentary, no code fence around the whole answer.`;

function buildPrompt(pageCount: number): string {
  return `This PDF holds ${pageCount} page(s) selected from a larger technical manual, because each one appears to contain a table.

For EACH page, in order, output:
1. A line containing only ${pageMarker(1)} where the number is the page's 1-based position in THIS PDF. The first page is 1, the second is 2, and so on. Ignore any page number printed on the page itself.
2. That page's complete text, in reading order.

${PROMPT_TAIL}`;
}

// Models occasionally wrap the whole answer in a fence despite being told
// not to. Strip one leading/trailing fence rather than letting it become
// the first line of a page's text.
function stripOuterFence(raw: string): string {
  const t = raw.trim();
  if (!t.startsWith("```")) return t;
  const firstNewline = t.indexOf("\n");
  if (firstNewline === -1) return t;
  const body = t.slice(firstNewline + 1);
  return body.endsWith("```") ? body.slice(0, -3).trimEnd() : body;
}

export type TableExtraction = {
  /** Original 1-indexed page number to its re-extracted text. */
  byPage: Map<number, string>;
  /** Pages that were requested but never came back, for logging. */
  missing: number[];
  /** True when a deadline stopped the pass before every batch ran. */
  truncated: boolean;
};

/**
 * Re-reads `pages` (original 1-indexed page numbers, ascending) with
 * vision and returns their text with tables rendered as Markdown.
 *
 * Never throws: a failed batch is logged and skipped, because a document
 * that ingests with some pages still linearized is strictly better than a
 * document that fails to ingest. Callers splice in whatever comes back.
 */
export async function extractPageTables(
  buf: Buffer,
  pages: number[],
  opts: {
    usage?: UsageAttribution;
    /** ms epoch after which no further batch is started. */
    deadlineAt?: number | null;
    onBatchStart?: (done: number, total: number) => void | Promise<void>;
  } = {},
): Promise<TableExtraction> {
  const byPage = new Map<number, string>();
  if (pages.length === 0) {
    return { byPage, missing: [], truncated: false };
  }

  const batches: number[][] = [];
  for (let i = 0; i < pages.length; i += TABLE_BATCH_PAGES) {
    batches.push(pages.slice(i, i + TABLE_BATCH_PAGES));
  }

  const anthropic = new Anthropic();
  let truncated = false;
  let done = 0;

  for (const batch of batches) {
    if (opts.deadlineAt !== null && opts.deadlineAt !== undefined) {
      if (Date.now() >= opts.deadlineAt - BATCH_TIME_RESERVE_MS) {
        // Out of time. Everything already spliced still counts; the rest
        // of the document keeps its pdf-parse text. A reprocess from the
        // admin UI finishes the job when the platform allows more time.
        truncated = true;
        break;
      }
    }
    if (opts.onBatchStart) {
      try {
        await opts.onBatchStart(done, batches.length);
      } catch {
        // Progress reporting must never abort the pass.
      }
    }
    done++;

    // Slicing is mandatory here, unlike the figure pass which can fall
    // back to the whole document: we are replacing specific pages, so
    // without a page mapping there is nothing safe to splice.
    const sliced = await slicePdfPages(buf, batch);
    if (!sliced) {
      console.warn(
        `extractPageTables: could not slice pages ${batch.join(",")}, skipping batch`,
      );
      continue;
    }

    try {
      const stream = anthropic.messages.stream({
        model: TABLE_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: sliced.buffer.toString("base64"),
                },
              },
              { type: "text", text: buildPrompt(sliced.originalPages.length) },
            ],
          },
        ],
      });
      const final = await stream.finalMessage();

      if (opts.usage) {
        await recordUsage({
          ...opts.usage,
          provider: "anthropic",
          model: TABLE_MODEL,
          operation: "table_extraction",
          ...fromAnthropicUsage(final.usage),
        });
      }

      const text = stripOuterFence(
        final.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("")
          .trim(),
      );

      for (const segment of splitPageSegments(text)) {
        if (segment.page === null) {
          // Text before the first marker. The model was told to lead with
          // one, so this is stray commentary rather than page content.
          continue;
        }
        const original = toOriginalPage(segment.page, sliced.originalPages);
        if (original === null) {
          console.warn(
            `extractPageTables: dropping unmappable page ${segment.page} ` +
              `(batch had ${sliced.originalPages.length} pages)`,
          );
          continue;
        }
        const body = segment.text.trim();
        if (body) byPage.set(original, body);
      }
    } catch (err) {
      console.warn(
        `extractPageTables: batch ${batch.join(",")} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    byPage,
    missing: pages.filter((p) => !byPage.has(p)),
    truncated,
  };
}
