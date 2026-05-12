// Claude-vision helpers for the image side of the KB.
//
// Two shapes:
//   captionImage(buf, mime) — single standalone image (operator upload).
//     Returns one caption + alt text suitable for embedding & rendering.
//   extractPdfFigures(buf) — figure inventory for a PDF. Returns a list
//     of {page, caption, altText} for every figure/diagram/photo present.
//     Used by ingestPdf to seed kb_assets rows pointing back at the PDF.
//
// We use Sonnet for both — figure extraction over a multi-page manual is
// a noticeable accuracy step up from Haiku, and the cost is dwarfed by
// the OCR pass that ran just before.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export type ImageCaption = {
  caption: string;
  altText: string;
};

export async function captionImage(
  buf: Buffer,
  mime: ImageMime,
): Promise<ImageCaption> {
  const anthropic = new Anthropic();
  const base64 = buf.toString("base64");

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mime, data: base64 },
          },
          {
            type: "text",
            text:
              "Describe this image as if it were a figure from a machine manual that operators will search by keyword. " +
              "Return ONLY a JSON object with two fields: " +
              "  \"caption\": one or two sentences naming every visible component, label, callout, alarm code, button, and what's being shown. Include any text rendered in the image verbatim. " +
              "  \"alt_text\": a single short phrase (<= 12 words) suitable as an <img alt>. " +
              "Do not add prose outside the JSON object. No code fences.",
          },
        ],
      },
    ],
  });

  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return parseCaption(text);
}

function parseCaption(raw: string): ImageCaption {
  // Be lenient — the model sometimes wraps the JSON in code fences
  // despite the instruction. Strip them before parsing.
  const stripped = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const obj = JSON.parse(stripped) as {
      caption?: unknown;
      alt_text?: unknown;
    };
    const caption =
      typeof obj.caption === "string" && obj.caption.trim()
        ? obj.caption.trim()
        : null;
    const altText =
      typeof obj.alt_text === "string" && obj.alt_text.trim()
        ? obj.alt_text.trim()
        : caption;
    if (!caption) throw new Error("missing caption field");
    return { caption, altText: altText ?? caption };
  } catch {
    // Fallback: treat the whole blob as the caption. Better to ingest
    // a sloppy caption than to fail the upload outright.
    const fallback = stripped || "Image";
    return { caption: fallback, altText: fallback.slice(0, 80) };
  }
}

export type PdfFigure = {
  page: number;
  caption: string;
  altText: string;
};

// Pulls a structured figure inventory from a PDF. We send the whole PDF
// once (Claude's document input handles multi-page PDFs natively) and
// ask for one row per visible figure/diagram. The list is bounded — we
// cap output tokens and the model is told to skip pure-text pages.
export async function extractPdfFigures(buf: Buffer): Promise<PdfFigure[]> {
  const anthropic = new Anthropic();
  const base64 = buf.toString("base64");

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 8000,
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
              "List every figure, diagram, photo, schematic, screenshot, table-as-image, or labelled illustration in this PDF. " +
              "Skip pages that are pure prose, plain tables, or blank. " +
              "Return ONLY a JSON array. Each element: {\"page\": <1-indexed page number>, \"caption\": <one or two sentences naming every visible component, label, callout, alarm code, and what's being shown — include any text rendered in the figure verbatim>, \"alt_text\": <short phrase, <= 12 words>}. " +
              "If the PDF contains no figures, return []. No prose, no code fences.",
          },
        ],
      },
    ],
  });

  const final = await stream.finalMessage();
  const text = final.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return parseFigures(text);
}

function parseFigures(raw: string): PdfFigure[] {
  const stripped = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  let arr: unknown;
  try {
    arr = JSON.parse(stripped);
  } catch {
    console.warn("extractPdfFigures: model output was not valid JSON, skipping");
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const out: PdfFigure[] = [];
  for (const entry of arr) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as { page?: unknown; caption?: unknown; alt_text?: unknown };
    const page = typeof e.page === "number" && e.page > 0 ? Math.floor(e.page) : null;
    const caption =
      typeof e.caption === "string" && e.caption.trim() ? e.caption.trim() : null;
    const altText =
      typeof e.alt_text === "string" && e.alt_text.trim()
        ? e.alt_text.trim()
        : caption;
    if (page === null || caption === null) continue;
    out.push({ page, caption, altText: altText ?? caption });
  }
  return out;
}

export function isSupportedImageMime(mime: string): mime is ImageMime {
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp";
}

export function extensionForMime(mime: ImageMime): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
  }
}
