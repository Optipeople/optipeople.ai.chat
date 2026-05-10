// PDF text extraction with automatic OCR fallback.
//
// Flow:
//   1. pdf-parse reads the embedded text layer. Fast, free, works for
//      90 % of vendor manuals.
//   2. If the result looks empty (image-only PDFs, scans, exports where
//      someone rasterised the text) the buffer is handed to Claude with
//      vision. Claude extracts text in reading order including content
//      that's rendered as images. Slower and costs API tokens, but the
//      typical manual is a single-digit-dollar ingest.
//
// Threshold tuning: a real manual page usually carries hundreds of
// characters. Anything below 30 chars/page (or under 100 chars total) is
// almost certainly an image-only PDF — fall back to OCR.

import { createRequire } from "node:module";
import Anthropic from "@anthropic-ai/sdk";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

// Sonnet handles complex layouts (tables, multi-column technical docs)
// noticeably better than Haiku — worth the extra cost on the rare paths
// where OCR actually runs.
const OCR_MODEL = "claude-sonnet-4-6";

// A real manual page typically carries 1000+ characters once you strip
// whitespace; under ~400/page is the tell that the page is mostly
// images, scans, or rasterised text. Earlier thresholds (30/page) were
// way too generous — page numbers and headers alone could trip past
// them, leaving image-heavy PDFs ingesting as empty chunks.
const MIN_CHARS_PER_PAGE = 400;
const ABSOLUTE_MIN = 500;

export type PdfExtractionSource = "pdf-parse" | "claude-ocr";

export type PdfExtractionForce = "ocr" | "pdf-parse";

export type PdfExtractionResult = {
  text: string;
  pageCount: number;
  source: PdfExtractionSource;
};

function clean(raw: string): string {
  return raw.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractWithClaude(buf: Buffer): Promise<string> {
  const anthropic = new Anthropic();
  const base64 = buf.toString("base64");

  // The SDK forces streaming for any request whose worst-case duration
  // could exceed 10 minutes — a 32k-output OCR pass over a multi-page
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
              "Do not summarise, paraphrase, or describe visuals — output the literal text only. " +
              "If a page is purely a diagram with no readable text, write a short bracketed note " +
              "like [Diagram: tool change sequence] in its place.",
          },
        ],
      },
    ],
  });

  const final = await stream.finalMessage();

  const parts: string[] = [];
  for (const block of final.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("");
}

export type ExtractPhaseHook = (
  phase: PdfExtractionSource,
) => void | Promise<void>;

export async function extractPdfText(
  buf: Buffer,
  opts: { force?: PdfExtractionForce; onPhaseStart?: ExtractPhaseHook } = {},
): Promise<PdfExtractionResult> {
  const phase = async (p: PdfExtractionSource) => {
    if (!opts.onPhaseStart) return;
    try {
      await opts.onPhaseStart(p);
    } catch (err) {
      console.warn("extractPdfText: onPhaseStart failed:", err);
    }
  };

  const { text: raw, numpages } = await pdfParse(buf);
  const cleaned = clean(raw);

  if (opts.force === "pdf-parse") {
    await phase("pdf-parse");
    return { text: cleaned, pageCount: numpages, source: "pdf-parse" };
  }

  if (opts.force === "ocr") {
    console.log(
      `[pdfText] forced Claude OCR (${cleaned.length} chars / ${numpages} pages from pdf-parse)`,
    );
    await phase("claude-ocr");
    const ocr = await extractWithClaude(buf);
    return {
      text: clean(ocr),
      pageCount: numpages,
      source: "claude-ocr",
    };
  }

  const charsPerPage = numpages > 0 ? cleaned.length / numpages : 0;
  const tooThin =
    cleaned.length < ABSOLUTE_MIN || charsPerPage < MIN_CHARS_PER_PAGE;

  if (!tooThin) {
    await phase("pdf-parse");
    return { text: cleaned, pageCount: numpages, source: "pdf-parse" };
  }

  console.log(
    `[pdfText] low text yield (${cleaned.length} chars / ${numpages} pages, ` +
      `${charsPerPage.toFixed(0)}/page) — falling back to Claude OCR`,
  );
  await phase("claude-ocr");
  const ocr = await extractWithClaude(buf);
  const cleanedOcr = clean(ocr);
  return { text: cleanedOcr, pageCount: numpages, source: "claude-ocr" };
}
