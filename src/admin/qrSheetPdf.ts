// QR stickers on Avery 90x120-R label sheets: A4 with four 90 x 120 mm
// die-cut labels, printed by the admin on an ordinary office printer.
//
// The sheet geometry is read from Avery's own template for this product
// (A-1895-01, "RA-Labels-4TV"), where it is given in twips (1/1440 in).
// The PDF page is exactly A4, so it must be printed at actual size (100 %).
// Per-printer drift is corrected with an X/Y offset the admin finds with
// the test sheet, which prints only the label outlines.

import { PDFDocument, rgb } from "pdf-lib";
import {
  AVERY_90X120_STICKER,
  canvasToBlob,
  renderQrStickerCanvas,
  type QrStickerArgs,
} from "./qrSticker";

const TWIPS_PER_MM = 1440 / 25.4;

export const SHEET_MM = { w: 210, h: 297 } as const;
export const LABEL_MM = {
  w: 5102.36224 / TWIPS_PER_MM, // 90
  h: 6803.14965 / TWIPS_PER_MM, // 120
  r: 113.38582 / TWIPS_PER_MM, // 2
} as const;
const GRID_MM = {
  x: 708.66142 / TWIPS_PER_MM, // 12.5, left edge of the first column
  y: 1470.10394 / TWIPS_PER_MM, // 25.93, top edge of the first row
  hPitch: 5385.82681 / TWIPS_PER_MM, // 95
  vPitch: 7086.61422 / TWIPS_PER_MM, // 125
  across: 2,
  down: 2,
} as const;
export const LABELS_PER_SHEET = GRID_MM.across * GRID_MM.down;

// Format px per mm of the label artwork.
const PX_PER_MM = AVERY_90X120_STICKER.W / LABEL_MM.w;
const PT_PER_MM = 72 / 25.4;

export type SheetOptions = {
  // First free label on the first sheet (0-3, reading order), so a sheet
  // with some labels already used can be fed again.
  startSlot: number;
  // Printer correction in mm; positive x moves right, positive y down.
  offsetX: number;
  offsetY: number;
  // Artwork beyond the trim on every side, in mm. The 5 mm gutter between
  // labels leaves room for up to 2.5 mm.
  bleed: number;
  // Draw the label outline on top (for checking alignment).
  outline: boolean;
};

export const DEFAULT_SHEET_OPTIONS: SheetOptions = {
  startSlot: 0,
  offsetX: 0,
  offsetY: 0,
  bleed: 1.5,
  outline: false,
};

export type SheetSlot<T> = { slot: number; item: T };

// Top-left corner of a label slot, in mm from the sheet's top-left.
export function slotPosition(slot: number): { x: number; y: number } {
  const col = slot % GRID_MM.across;
  const row = Math.floor(slot / GRID_MM.across);
  return { x: GRID_MM.x + col * GRID_MM.hPitch, y: GRID_MM.y + row * GRID_MM.vPitch };
}

// Splits stickers into sheets of four, starting at `startSlot` on sheet one.
export function layoutSheets<T>(items: T[], startSlot: number): SheetSlot<T>[][] {
  const sheets: SheetSlot<T>[][] = [];
  let sheet: SheetSlot<T>[] = [];
  let slot = Math.min(Math.max(0, Math.floor(startSlot)), LABELS_PER_SHEET - 1);
  for (const item of items) {
    sheet.push({ slot, item });
    slot += 1;
    if (slot === LABELS_PER_SHEET) {
      sheets.push(sheet);
      sheet = [];
      slot = 0;
    }
  }
  if (sheet.length) sheets.push(sheet);
  return sheets;
}

export function clampBleed(mm: number): number {
  return Math.min(2.5, Math.max(0, Number.isFinite(mm) ? mm : 0));
}

// One label's artwork, bleed included, at `scale` of the 1200 x 1600 format.
export function renderLabelCanvas(
  args: QrStickerArgs,
  bleedMm: number,
  scale = 1,
): Promise<HTMLCanvasElement> {
  return renderQrStickerCanvas(args, {
    format: AVERY_90X120_STICKER,
    bleed: clampBleed(bleedMm) * PX_PER_MM,
    scale,
  });
}

function roundedRectPath(w: number, h: number, r: number): string {
  return [
    `M ${r} 0`,
    `L ${w - r} 0`,
    `A ${r} ${r} 0 0 1 ${w} ${r}`,
    `L ${w} ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `L ${r} ${h}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    "Z",
  ].join(" ");
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Builds the print PDF: one exact A4 page per sheet. Stickers render one at
// a time and are embedded straight away, like buildStickerPdf, so a batch
// of 1000 stays inside a tab's memory. With `testOnly` it prints one sheet
// with label outlines and centre marks only.
export async function buildSheetPdf(
  items: QrStickerArgs[],
  options: SheetOptions,
  {
    testOnly = false,
    onProgress,
  }: { testOnly?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const sheets: SheetSlot<QrStickerArgs | null>[][] = testOnly
    ? [Array.from({ length: LABELS_PER_SHEET }, (_, slot) => ({ slot, item: null }))]
    : layoutSheets(items, options.startSlot);
  const total = sheets.reduce((n, s) => n + s.length, 0);
  const bleed = clampBleed(options.bleed);
  const mark = rgb(0.88, 0, 0.48);
  let done = 0;
  onProgress?.(0, total);

  for (const sheet of sheets) {
    const page = pdf.addPage([SHEET_MM.w * PT_PER_MM, SHEET_MM.h * PT_PER_MM]);
    for (const { slot, item } of sheet) {
      const p = slotPosition(slot);
      const x = p.x + options.offsetX;
      const top = p.y + options.offsetY;
      if (item) {
        const canvas = await renderLabelCanvas(item, bleed);
        let bytes: ArrayBuffer;
        try {
          bytes = await (await canvasToBlob(canvas, "image/png")).arrayBuffer();
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
        const image = await pdf.embedPng(bytes);
        await image.embed();
        const w = LABEL_MM.w + 2 * bleed;
        const h = LABEL_MM.h + 2 * bleed;
        page.drawImage(image, {
          x: (x - bleed) * PT_PER_MM,
          y: (SHEET_MM.h - (top - bleed) - h) * PT_PER_MM,
          width: w * PT_PER_MM,
          height: h * PT_PER_MM,
        });
      }
      if (testOnly || options.outline) {
        // The die-cut shape, rounded corners included, so the test sheet
        // can be laid over a real label sheet. drawSvgPath measures from
        // the given top-left with y pointing down, like SVG.
        page.drawSvgPath(roundedRectPath(LABEL_MM.w * PT_PER_MM, LABEL_MM.h * PT_PER_MM, LABEL_MM.r * PT_PER_MM), {
          x: x * PT_PER_MM,
          y: (SHEET_MM.h - top) * PT_PER_MM,
          borderColor: mark,
          borderWidth: 0.5,
        });
      }
      if (testOnly) {
        const cx = x + LABEL_MM.w / 2;
        const cy = SHEET_MM.h - top - LABEL_MM.h / 2;
        page.drawLine({
          start: { x: (cx - 5) * PT_PER_MM, y: cy * PT_PER_MM },
          end: { x: (cx + 5) * PT_PER_MM, y: cy * PT_PER_MM },
          thickness: 0.5,
          color: mark,
        });
        page.drawLine({
          start: { x: cx * PT_PER_MM, y: (cy - 5) * PT_PER_MM },
          end: { x: cx * PT_PER_MM, y: (cy + 5) * PT_PER_MM },
          thickness: 0.5,
          color: mark,
        });
      }
      done += 1;
      onProgress?.(done, total);
      await nextTick();
    }
  }

  const out = await pdf.save({ addDefaultPage: false });
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

// Draws a preview of one sheet onto `canvas` at `pxPerMm`: dashed outlines
// for every label position, the stickers at their printed position (offset
// and bleed included), and solid outlines when `outline` is on. When
// `isCancelled` turns true while the labels render (the settings changed),
// the canvas is left alone for the newer redraw.
export async function drawSheetPreview(
  canvas: HTMLCanvasElement,
  sheet: SheetSlot<QrStickerArgs>[],
  options: SheetOptions,
  pxPerMm: number,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const labels = await Promise.all(
    sheet.map(({ item }) => renderLabelCanvas(item, options.bleed, pxPerMm / PX_PER_MM)),
  );
  try {
    if (!isCancelled()) paintSheet(canvas, sheet, labels, options, pxPerMm);
  } finally {
    for (const l of labels) {
      l.width = 0;
      l.height = 0;
    }
  }
}

function paintSheet(
  canvas: HTMLCanvasElement,
  sheet: SheetSlot<QrStickerArgs>[],
  labels: HTMLCanvasElement[],
  options: SheetOptions,
  pxPerMm: number,
): void {
  canvas.width = Math.round(SHEET_MM.w * pxPerMm);
  canvas.height = Math.round(SHEET_MM.h * pxPerMm);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const s = pxPerMm;
  const outlineAt = (slot: number, dashed: boolean) => {
    const p = slotPosition(slot);
    ctx.save();
    ctx.strokeStyle = "#E0007A";
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.roundRect(p.x * s, p.y * s, LABEL_MM.w * s, LABEL_MM.h * s, LABEL_MM.r * s);
    ctx.stroke();
    ctx.restore();
  };
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let slot = 0; slot < LABELS_PER_SHEET; slot++) outlineAt(slot, true);
  const bleed = clampBleed(options.bleed);
  sheet.forEach(({ slot }, i) => {
    const p = slotPosition(slot);
    ctx.drawImage(
      labels[i],
      (p.x + options.offsetX - bleed) * s,
      (p.y + options.offsetY - bleed) * s,
      (LABEL_MM.w + 2 * bleed) * s,
      (LABEL_MM.h + 2 * bleed) * s,
    );
    if (options.outline) outlineAt(slot, false);
  });
}

// Reads a CSV of stickers: the code,url file from "Hent CSV", optionally
// with a name column that replaces the title. The delimiter is taken from
// the first line, comma or semicolon (Excel in Danish saves with
// semicolons and leaves commas in fields unquoted). A file without a
// header works too, as long as one column holds the URL.
export type SheetCsvRow = { code: string; url: string; name: string };

function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const c of text) {
    if (c === "\n" || c === "\r") {
      if (!quoted) break;
    } else if (c === '"') quoted = !quoted;
    else if (!quoted && c === ",") commas++;
    else if (!quoted && c === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

export function parseStickerCsv(input: string): SheetCsvRow[] {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // A quote only opens a quoted field at the start of the field, so a
  // stray inch mark (12" rør) stays literal.
  let atFieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
      atFieldStart = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      atFieldStart = true;
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  const clean = rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some(Boolean));
  if (!clean.length) return [];

  const head = clean[0].map((h) => h.toLowerCase());
  let iCode = head.indexOf("code");
  let iUrl = head.indexOf("url");
  let iName = head.indexOf("name");
  let body = clean.slice(1);
  if (iUrl < 0) {
    body = clean;
    iUrl = clean[0].findIndex((v) => /^https?:\/\//i.test(v));
    if (iUrl < 0) throw new Error("no-url-column");
    iCode = iUrl === 0 ? -1 : 0;
    iName = -1;
  }
  return body
    .map((r) => ({
      code: iCode >= 0 ? (r[iCode] ?? "") : "",
      url: r[iUrl] ?? "",
      name: iName >= 0 ? (r[iName] ?? "") : "",
    }))
    .filter((r) => /^https?:\/\//i.test(r.url));
}
