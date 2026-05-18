// Pure string-to-slug converter shared by server-side TOC extraction
// (legalDocs.ts) and the client-side heading renderer (markdown.tsx).
// Kept in its own module so the Markdown client component doesn't drag
// node:fs/promises into the browser bundle.
//
// Handles Danish characters explicitly because NFKD doesn't decompose
// æ/ø.

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
