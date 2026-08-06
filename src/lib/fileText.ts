// Text extraction for arbitrary uploaded files.
//
// Two paths:
//   "text"    — the bytes are already UTF-8 text (CSV, log, JSON, ST, …).
//   "archive" — the bytes are a ZIP container (.zip, .docx/.xlsx/.pptx,
//               and OEM formats like Omron Sysmac .smc2, which are ZIPs of
//               XML). We unzip in memory and pull readable text out of the
//               member files: element/attribute names, text nodes, and
//               comments. Long unbroken tokens (base64 blobs, encrypted
//               POU bodies, checksums) are dropped — they're noise that
//               only dilutes embeddings.
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

function extractArchive(buffer: Buffer): string {
  const entries = unzipSync(new Uint8Array(buffer));
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
