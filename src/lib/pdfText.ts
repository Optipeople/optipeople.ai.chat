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

const MIN_CHARS_PER_PAGE = 30;
const ABSOLUTE_MIN = 100;

export type PdfExtractionSource = "pdf-parse" | "claude-ocr";

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

  const response = await anthropic.messages.create({
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

  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("");
}

export async function extractPdfText(buf: Buffer): Promise<PdfExtractionResult> {
  const { text: raw, numpages } = await pdfParse(buf);
  const cleaned = clean(raw);
  const charsPerPage = numpages > 0 ? cleaned.length / numpages : 0;

  const tooThin =
    cleaned.length < ABSOLUTE_MIN || charsPerPage < MIN_CHARS_PER_PAGE;

  if (!tooThin) {
    return { text: cleaned, pageCount: numpages, source: "pdf-parse" };
  }

  console.log(
    `[pdfText] low text yield (${cleaned.length} chars / ${numpages} pages, ` +
      `${charsPerPage.toFixed(0)}/page) — falling back to Claude OCR`,
  );
  const ocr = await extractWithClaude(buf);
  const cleanedOcr = clean(ocr);
  return { text: cleanedOcr, pageCount: numpages, source: "claude-ocr" };
}
