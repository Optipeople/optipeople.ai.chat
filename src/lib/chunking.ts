// Structure-aware chunking with page provenance.
//
// Two jobs the old plain character splitter could not do, both of them
// causes of the 2026-08-19 wrong-DIP-switch incident
// (docs/answer-correctness-plan.md):
//
//   1. PAGE PROVENANCE. Extraction now emits `<<<page:N>>>` sentinels
//      between pages (see pdfText.ts). We split on those first, so every
//      chunk knows which pages it came from. That fills kb_chunks.
//      page_from / page_to, which were hard-coded null before, and those
//      feed the source-chip deep link, the model's page citations, and
//      the get_page_image tool.
//
//   2. TABLE INTEGRITY. A cut between a table's header row and its value
//      rows destroys the column-to-value binding as thoroughly as not
//      extracting the table at all. A run of table rows is therefore an
//      ATOMIC block: never split, even when it is larger than the target
//      chunk size. Voyage takes a single oversized input on its own (see
//      planEmbedBatches) and truncates at the model context, so an
//      oversized table chunk is safe where a bisected one is not.
//
// The sentinels never reach the database: they are consumed here and
// stripped from every chunk's text. kb_chunks.text_tsv is a generated
// tsvector over text, so a leaked marker would pollute the BM25 index.
//
// chunkText must stay a deterministic pure function. The ingest pipeline
// recomputes the chunk list from its extraction sidecar to resume at the
// first ordinal missing from kb_chunks; any non-determinism here silently
// corrupts a resumed document.

/** Sentinel written by the extractors ahead of each page's text. */
export function pageMarker(page: number): string {
  return `<<<page:${page}>>>`;
}

// Trailing whitespace/newline is swallowed with the marker so removing it
// doesn't leave a blank line where the sentinel used to be.
const PAGE_MARKER_RE = /<<<page:(\d+)>>>[ \t]*\r?\n?/g;

export function stripPageMarkers(text: string): string {
  return text.replace(PAGE_MARKER_RE, "");
}

/** True when the text carries at least one page sentinel. */
export function hasPageMarkers(text: string): boolean {
  return /<<<page:\d+>>>/.test(text);
}

export type PageSegment = {
  /** 1-indexed page, or null when the text carried no sentinels. */
  page: number | null;
  text: string;
};

/**
 * Splits marker-bearing text into per-page segments. Text before the
 * first marker (or all of it, when there are no markers) comes back as a
 * single page-less segment rather than being dropped.
 */
export function splitPageSegments(text: string): PageSegment[] {
  const segments: PageSegment[] = [];
  let lastIndex = 0;
  let currentPage: number | null = null;
  const re = new RegExp(PAGE_MARKER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const chunk = text.slice(lastIndex, m.index);
    if (chunk.trim()) segments.push({ page: currentPage, text: chunk });
    currentPage = Number.parseInt(m[1], 10);
    lastIndex = m.index + m[0].length;
  }
  const tail = text.slice(lastIndex);
  if (tail.trim()) segments.push({ page: currentPage, text: tail });
  return segments;
}

// ---------------------------------------------------------------------------
// Table detection
// ---------------------------------------------------------------------------

// Two or more pipes is the GitHub-flavored table signature. One pipe
// appears in ordinary prose and in parameter syntax often enough that a
// single-pipe test would swallow whole pages.
function isTableRow(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  let pipes = 0;
  for (const ch of t) if (ch === "|") pipes++;
  return pipes >= 2;
}

// The |---|:--:| line under a GFM header. Its presence makes a two-line
// run unambiguously a table.
function isTableDelimiterRow(line: string): boolean {
  const t = line.trim();
  if (!isTableRow(t)) return false;
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(t) && /-/.test(t);
}

// A shorter run than this is more likely to be prose that happens to
// contain pipes. Three lines is also the minimum for a real GFM table
// (header, delimiter, one row), so nothing legitimate is excluded.
const MIN_TABLE_ROWS = 3;

// A table's caption or number line ("Table 3-2 DIP switch settings") is
// pulled into the table block so it can never be separated from it. Long
// lines are prose, not captions.
const CAPTION_MAX_CHARS = 200;

export type TextBlock = {
  text: string;
  /** Atomic blocks are never split, whatever their size. */
  atomic: boolean;
};

/**
 * Splits one page's text into alternating prose and table blocks. Table
 * blocks come back atomic, with the caption line above them absorbed.
 */
export function splitTableBlocks(text: string): TextBlock[] {
  const lines = text.split("\n");
  const blocks: TextBlock[] = [];
  let prose: string[] = [];

  const flushProse = () => {
    const joined = prose.join("\n");
    if (joined.trim()) blocks.push({ text: joined, atomic: false });
    prose = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (!isTableRow(lines[i])) {
      prose.push(lines[i]);
      continue;
    }
    // Measure the run of consecutive table rows starting here.
    let end = i;
    while (end + 1 < lines.length && isTableRow(lines[end + 1])) end++;
    const runLength = end - i + 1;
    const hasDelimiter = lines
      .slice(i, end + 1)
      .some((l) => isTableDelimiterRow(l));
    if (runLength < MIN_TABLE_ROWS && !(runLength >= 2 && hasDelimiter)) {
      // Too short to trust as a table. Treat as prose.
      for (let k = i; k <= end; k++) prose.push(lines[k]);
      i = end;
      continue;
    }

    // Absorb the caption: the nearest preceding non-empty prose line,
    // provided it is separated from the table by at most one blank line.
    const captionLines: string[] = [];
    let blanks = 0;
    while (prose.length > 0) {
      const last = prose[prose.length - 1];
      if (!last.trim()) {
        if (blanks >= 1) break;
        blanks++;
        prose.pop();
        continue;
      }
      if (last.trim().length > CAPTION_MAX_CHARS) break;
      captionLines.unshift(prose.pop() as string);
      break;
    }
    flushProse();
    blocks.push({
      text: [...captionLines, ...lines.slice(i, end + 1)].join("\n"),
      atomic: true,
    });
    i = end;
  }
  flushProse();
  return blocks;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

// Recursive splitter: tries the most natural break points first
// (paragraph, newline, sentence, hard char split). Unchanged behaviour
// from the original chunker, but it now only ever sees non-table text.
//
// We can't rely on PDF text being well-formatted (pdf-parse often loses
// paragraph breaks), so the recursive fallback is what makes this robust.
function splitRecursive(text: string, target: number): string[] {
  if (text.length <= target) return [text];
  const seps = ["\n\n", "\n", ". ", " ", ""];
  for (const sep of seps) {
    if (sep === "") {
      // Last resort: hard split.
      const out: string[] = [];
      for (let i = 0; i < text.length; i += target) {
        out.push(text.slice(i, i + target));
      }
      return out;
    }
    const parts = text.split(sep);
    if (parts.length === 1) continue;
    const out: string[] = [];
    for (const part of parts) {
      if (part.length <= target) out.push(part);
      else out.push(...splitRecursive(part, target));
    }
    return out;
  }
  return [text];
}

export type Chunk = {
  text: string;
  /** First page the chunk draws from, null when provenance is unknown. */
  pageFrom: number | null;
  /** Last page the chunk draws from. Equals pageFrom for single-page chunks. */
  pageTo: number | null;
};

type Piece = {
  text: string;
  pageFrom: number | null;
  pageTo: number | null;
  atomic: boolean;
};

function minPage(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function maxPage(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

// Tables continued across a page break become one block when the two
// runs are literally adjacent in the text stream. This only fires when
// no running header or footer sits between them, so it is a bonus rather
// than something later logic may rely on.
function stitchCrossPageTables(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const piece of pieces) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.atomic &&
      piece.atomic &&
      isTableRow(prev.text.split("\n").pop() ?? "") &&
      isTableRow(piece.text.split("\n")[0] ?? "")
    ) {
      out[out.length - 1] = {
        text: `${prev.text}\n${piece.text}`,
        pageFrom: minPage(prev.pageFrom, piece.pageFrom),
        pageTo: maxPage(prev.pageTo, piece.pageTo),
        atomic: true,
      };
      continue;
    }
    out.push(piece);
  }
  return out;
}

/**
 * Splits extracted document text into embeddable chunks of roughly
 * `target` characters, sharing `overlap` trailing characters with the
 * next chunk. Tables are never split and page provenance is carried
 * through from `<<<page:N>>>` sentinels.
 */
export function chunkText(
  text: string,
  target = 3500,
  overlap = 400,
): Chunk[] {
  const pieces: Piece[] = [];
  for (const segment of splitPageSegments(text)) {
    for (const block of splitTableBlocks(segment.text)) {
      if (block.atomic) {
        pieces.push({
          text: block.text,
          pageFrom: segment.page,
          pageTo: segment.page,
          atomic: true,
        });
        continue;
      }
      for (const part of splitRecursive(block.text, target)) {
        if (!part.trim()) continue;
        pieces.push({
          text: part,
          pageFrom: segment.page,
          pageTo: segment.page,
          atomic: false,
        });
      }
    }
  }

  const chunks: Chunk[] = [];
  let current = "";
  let pageFrom: number | null = null;
  let pageTo: number | null = null;
  // Whether the piece that closed the current chunk was a table. The
  // overlap carry is skipped after one: a tail sliced out of a table is
  // a handful of header-less rows, which is exactly the misleading
  // fragment this module exists to prevent.
  let lastWasTable = false;

  const flush = () => {
    const cleaned = stripPageMarkers(current).trim();
    if (cleaned) chunks.push({ text: cleaned, pageFrom, pageTo });
  };

  for (const piece of stitchCrossPageTables(pieces)) {
    const sep = current ? "\n\n" : "";
    if (current && current.length + sep.length + piece.text.length > target) {
      flush();
      const carry = lastWasTable ? "" : current.slice(-overlap);
      if (carry) {
        current = `${carry}\n\n${piece.text}`;
        // The carried tail still belongs to the pages just flushed, so
        // the new chunk legitimately spans both.
        pageFrom = minPage(pageFrom, piece.pageFrom);
      } else {
        current = piece.text;
        pageFrom = piece.pageFrom;
      }
      pageTo = piece.pageTo;
    } else if (current) {
      current += sep + piece.text;
      pageFrom = minPage(pageFrom, piece.pageFrom);
      pageTo = maxPage(pageTo, piece.pageTo);
    } else {
      current = piece.text;
      pageFrom = piece.pageFrom;
      pageTo = piece.pageTo;
    }
    lastWasTable = piece.atomic;
  }
  flush();
  return chunks;
}

/** True when a chunk's text contains a table. Callers use this to keep
 * tables out of the truncation path on the way to the model. */
export function containsTable(text: string): boolean {
  const lines = text.split("\n");
  let run = 0;
  for (const line of lines) {
    if (isTableRow(line)) {
      run++;
      if (run >= MIN_TABLE_ROWS) return true;
      if (run >= 2 && isTableDelimiterRow(line)) return true;
    } else {
      run = 0;
    }
  }
  return false;
}
