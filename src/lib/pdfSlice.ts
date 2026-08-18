// Build a smaller PDF containing only selected pages.
//
// Used by the two vision passes so they send a handful of relevant pages
// instead of an entire manual. The page-number remap is the part that
// matters: once pages [12, 40, 77] become a 3-page PDF, the model reports
// them as pages 1, 2 and 3. Anything that writes a page number back to
// the database (figure anchors, "see page N") must translate through
// `originalPages` or the operator gets sent to the wrong page.

import { PDFDocument } from "pdf-lib";

export type SlicedPdf = {
  buffer: Buffer;
  /**
   * Original 1-indexed page numbers, in the order they appear in the
   * sliced PDF. `originalPages[i]` is the source page for sliced page
   * `i + 1`, so map a model-reported page with `toOriginalPage`.
   */
  originalPages: number[];
};

/**
 * Copies `pages` (1-indexed, in ascending order) into a new PDF.
 * Returns null if the slice can't be produced, so callers fall back to
 * the full document rather than losing content.
 */
export async function slicePdfPages(
  buf: Buffer,
  pages: number[],
): Promise<SlicedPdf | null> {
  if (pages.length === 0) return null;
  try {
    // Vendor manuals are frequently a bit malformed; pdf-lib refuses them
    // outright unless it is allowed to tolerate that, and a document we
    // only want to re-page does not need strict parsing.
    const src = await PDFDocument.load(new Uint8Array(buf), {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
    const total = src.getPageCount();

    // Drop anything out of range and de-duplicate while preserving order.
    // pdf.js and pdf-lib very occasionally disagree on page count for
    // damaged files, and an out-of-range index throws inside copyPages.
    const wanted: number[] = [];
    const seen = new Set<number>();
    for (const p of pages) {
      if (p >= 1 && p <= total && !seen.has(p)) {
        seen.add(p);
        wanted.push(p);
      }
    }
    if (wanted.length === 0) return null;

    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      wanted.map((p) => p - 1),
    );
    for (const page of copied) out.addPage(page);

    const bytes = await out.save();
    return { buffer: Buffer.from(bytes), originalPages: wanted };
  } catch (err) {
    console.warn(
      "slicePdfPages: falling back to whole document:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Translates a page number reported against a sliced PDF back to the
 * original document. Out-of-range input returns null so a hallucinated
 * page number can't silently anchor a figure to the wrong page.
 */
export function toOriginalPage(
  slicedPage: number,
  originalPages: number[],
): number | null {
  if (!Number.isInteger(slicedPage) || slicedPage < 1) return null;
  return originalPages[slicedPage - 1] ?? null;
}
