// Text extraction for arbitrary uploaded files.
//
// Two paths:
//   "text"    — the bytes are already UTF-8 text (CSV, log, JSON, ST, …).
//   "archive" — the bytes are a ZIP container (.zip, .docx/.xlsx/.pptx,
//               and OEM formats like Omron Sysmac .smc2, which are ZIPs of
//               XML). We unzip in memory and pull readable text out of the
//               member files: element/attribute names, text nodes, and
//               comments. Long unbroken tokens (base64 blobs, encrypted
//               POU bodies, checksums) are dropped: they're noise that
//               only dilutes embeddings. Excel workbooks are the exception:
//               they are read sheet by sheet as rows of cell values (see
//               extractSpreadsheet).
//
// Anything we can't turn into text returns source:"none" and is stored as
// a download-only attachment by the caller.
//
// Server-only — pulled in by fileIngestion.ts.

import { unzipSync } from "fflate";

export type FileTextSource = "text" | "archive" | "none";
export type FileTextResult = { text: string; source: FileTextSource };

// Cap the extracted text so a huge archive can't spawn thousands of
// embedding calls. ~2 MB ≈ 500–600 chunks, already generous.
const MAX_TEXT_CHARS = 2_000_000;

// Tokens longer than this with no internal whitespace are almost always
// base64 / hex / encrypted blobs — useless to embed, expensive to keep.
// GUIDs (36 chars) and ordinary long words stay under it.
const MAX_TOKEN_LEN = 60;

function isZip(buf: Buffer): boolean {
  // Local file header magic "PK\x03\x04". Empty archives use PK\x05\x06
  // but those carry no entries, so we don't bother.
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  );
}

function decodeUtf8(buf: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// Plausible-UTF-8-text check: no NUL bytes, low mojibake ratio. Returns
// the trimmed text when it passes.
function sniffText(buf: Buffer): { ok: boolean; text: string } {
  if (buf.length === 0) return { ok: false, text: "" };
  if (buf.includes(0)) return { ok: false, text: "" };
  const decoded = decodeUtf8(buf);
  let replacements = 0;
  for (const ch of decoded) if (ch === "�") replacements++;
  if (decoded.length > 0 && replacements / decoded.length > 0.02) {
    return { ok: false, text: "" };
  }
  const text = decoded.trim();
  return { ok: text.length > 0, text };
}

// Drops base64/encrypted noise and collapses whitespace.
function cleanTokens(s: string): string {
  return s
    .split(/\s+/)
    .filter((t) => t.length > 0 && t.length <= MAX_TOKEN_LEN)
    .join(" ");
}

// Flattens an XML document into searchable text: element local-names,
// attribute values, and decoded text nodes. We deliberately keep tag
// names because in formats like Sysmac they carry meaning (e.g.
// "NexCpuActionRunModeAtPowerOn"). Attribute values hold variable names,
// data types, library names, comments.
function xmlToText(xml: string): string {
  const parts: string[] = [];

  // Element local-names (strip any namespace prefix), de-duplicated to
  // avoid thousands of repeated tag names bloating the text.
  const names = new Set<string>();
  for (const m of xml.matchAll(/<\/?([A-Za-z_][\w.:-]*)/g)) {
    names.add(m[1].replace(/^.*:/, ""));
  }
  parts.push([...names].join(" "));

  // Attribute values.
  for (const m of xml.matchAll(/="([^"]*)"/g)) parts.push(m[1]);

  // Text nodes + CDATA, with the common entities decoded.
  const text = xml
    .replace(/<\?[\s\S]*?\?>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, " $1 ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x?[0-9a-fA-F]+;/g, " ")
    .replace(/<[^>]*>/g, " ");
  parts.push(text);

  return parts.join(" ");
}

function looksXml(name: string, raw: string): boolean {
  if (/\.(xml|manifest|svg|rels|config)$/i.test(name)) return true;
  // Strip a leading UTF-8 BOM before checking the first non-space char.
  return raw.replace(/^﻿/, "").trimStart().startsWith("<");
}

// ---------------------------------------------------------------------------
// Spreadsheets (.xlsx / .xlsm)
// ---------------------------------------------------------------------------
//
// The generic XML flattening is useless for a workbook: cell values live in
// sharedStrings.xml as an index table, the sheets hold only references, and
// styles.xml (several MB of attribute values in real customer files) buries
// the content. So a workbook gets its own path: one "## Sheet: <name>" block
// per worksheet, one line per row, cells separated by tabs. Tabs, not pipes,
// because chunkText treats pipe rows as an atomic table block that is never
// split, and a whole sheet must still be chunkable.

type ZipEntries = Record<string, Uint8Array>;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      safeCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number.parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
}

// Concatenated <t> runs of a shared string or inline string. Phonetic
// guides (<rPh>) are East Asian reading hints, not content.
function richText(xml: string): string {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXmlEntities(out);
}

function readEntry(entries: ZipEntries, name: string): string | null {
  const data = entries[name];
  return data ? decodeUtf8(Buffer.from(data)) : null;
}

function attr(attrs: string, key: string): string | null {
  const m = new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

// Resolves a relationship Target against the part that owns the rels file.
function resolvePartPath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${baseDir}/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

// Worksheets in workbook tab order, with their display names. Falls back
// to every xl/worksheets/*.xml when the workbook or its rels are missing.
function listSheets(entries: ZipEntries): { name: string; path: string }[] {
  const workbook = readEntry(entries, "xl/workbook.xml") ?? "";
  const rels = readEntry(entries, "xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) targets.set(id, resolvePartPath("xl", target));
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeXmlEntities(attr(m[1], "name") ?? "");
    const id = attr(m[1], "r:id");
    const path = id ? targets.get(id) : undefined;
    if (path && entries[path]) sheets.push({ name, path });
  }
  if (sheets.length > 0) return sheets;
  return Object.keys(entries)
    .filter((n) => /^xl\/worksheets\/[^/]+\.xml$/i.test(n))
    .sort()
    .map((path) => ({ name: path.split("/").pop() ?? path, path }));
}

// Built-in number formats that render as dates (ECMA-376 18.8.30).
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

// Style indexes (the cell "s" attribute) whose number format is a date.
// Without this a date cell reads as its serial number, e.g. 44649.
function dateStyleIndexes(styles: string): Set<number> {
  const customDate = new Set<number>();
  for (const m of styles.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number.parseInt(attr(m[1], "numFmtId") ?? "", 10);
    // Drop quoted literals, [colour]/[locale] tags and escapes before
    // looking for date tokens, so "0.0 \"days\"" is not taken for a date.
    const code = decodeXmlEntities(attr(m[1], "formatCode") ?? "")
      .replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (/[dmy]/i.test(code)) customDate.add(id);
  }
  const out = new Set<number>();
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  if (!xfs) return out;
  let index = 0;
  for (const m of xfs[1].matchAll(/<xf\b([^>]*?)\/?>/g)) {
    const fmt = Number.parseInt(attr(m[1], "numFmtId") ?? "0", 10);
    if (BUILTIN_DATE_FORMATS.has(fmt) || customDate.has(fmt)) out.add(index);
    index++;
  }
  return out;
}

// Excel serial day number to YYYY-MM-DD (plus HH:MM when there is a time
// part). The 1900 system's epoch is 1899-12-30 once the fictitious
// 1900-02-29 is accounted for; the 1904 system starts at 1904-01-01.
function serialToDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.round(serial * 86_400_000));
  const iso = d.toISOString();
  const time = iso.slice(11, 16);
  return time === "00:00" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`;
}

type SheetContext = {
  shared: string[];
  dateStyles: Set<number>;
  date1904: boolean;
};

function cellValue(attrs: string, inner: string, ctx: SheetContext): string {
  const type = attr(attrs, "t");
  if (type === "inlineStr") return richText(inner);
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
  if (!v) return "";
  const raw = decodeXmlEntities(v[1]);
  if (type === "s") return ctx.shared[Number.parseInt(raw, 10)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  if (!type || type === "n") {
    const style = Number.parseInt(attr(attrs, "s") ?? "", 10);
    if (ctx.dateStyles.has(style)) {
      return serialToDate(Number(raw), ctx.date1904) ?? raw;
    }
  }
  return raw;
}

function sheetToText(xml: string, ctx: SheetContext): string {
  const lines: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (!c[2]) continue; // styled but empty cell
      // Newlines inside a cell would break the one-row-per-line shape.
      const value = cellValue(c[1], c[2], ctx).replace(/\s+/g, " ").trim();
      if (value) cells.push(value);
    }
    if (cells.length > 0) lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

function extractSpreadsheet(entries: ZipEntries): string {
  const sst = readEntry(entries, "xl/sharedStrings.xml") ?? "";
  const shared: string[] = [];
  for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    shared.push(richText(m[1]));
  }
  const workbook = readEntry(entries, "xl/workbook.xml") ?? "";
  const ctx: SheetContext = {
    shared,
    dateStyles: dateStyleIndexes(readEntry(entries, "xl/styles.xml") ?? ""),
    date1904: /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbook),
  };

  const blocks: string[] = [];
  let total = 0;
  for (const sheet of listSheets(entries)) {
    const xml = readEntry(entries, sheet.path);
    if (!xml) continue;
    const body = sheetToText(xml, ctx);
    if (!body) continue;
    const block = `## Sheet: ${sheet.name}\n${body}`;
    blocks.push(block);
    total += block.length;
    if (total >= MAX_TEXT_CHARS) break;
  }
  return blocks.join("\n\n").slice(0, MAX_TEXT_CHARS);
}

function extractArchive(buffer: Buffer): string {
  const entries = unzipSync(new Uint8Array(buffer));
  if (entries["xl/workbook.xml"]) {
    const sheetText = extractSpreadsheet(entries);
    if (sheetText.trim()) return sheetText;
    // No cell values at all: fall through to the generic flattening.
  }
  const blocks: string[] = [];
  let total = 0;

  for (const [name, data] of Object.entries(entries)) {
    if (data.length === 0) continue; // directory / empty entry
    const buf = Buffer.from(data);
    const { ok, text: raw } = sniffText(buf);
    if (!ok) continue; // nested binary (images, sqlite, nested zips) — skip

    const body = cleanTokens(looksXml(name, raw) ? xmlToText(raw) : raw);
    if (!body.trim()) continue;

    const shortName = name.split("/").pop() || name;
    const block = `## ${shortName}\n${body.trim()}`;
    blocks.push(block);
    total += block.length;
    if (total >= MAX_TEXT_CHARS) break;
  }

  return blocks.join("\n\n").slice(0, MAX_TEXT_CHARS);
}

// Best-effort text extraction. Never throws — on any failure (corrupt
// archive, etc.) it returns source:"none" so the caller stores the file
// as a plain attachment instead of failing the whole upload.
export function extractFileText(buffer: Buffer): FileTextResult {
  if (isZip(buffer)) {
    try {
      const text = extractArchive(buffer);
      if (text.trim()) return { text, source: "archive" };
    } catch {
      // Fall through to store-only.
    }
    return { text: "", source: "none" };
  }

  const { ok, text } = sniffText(buffer);
  return ok ? { text, source: "text" } : { text: "", source: "none" };
}
