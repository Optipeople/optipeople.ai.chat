// Print output for QR stickers in bulk: a PDF with one A6 page per
// sticker (pre-printed pool batches and named per-machine stickers), and a
// code,url CSV for print shops that do variable data printing.
//
// A batch can hold 1000 stickers, so the PDF is built to stay inside a
// browser tab's memory: stickers render one at a time, each canvas is
// encoded to PNG and then released, and the image is embedded into the
// PDF straight away so pdf-lib drops the decoded pixels and keeps only
// the compressed stream. The loop yields between stickers so the caller
// can paint progress.
//
// PNG rather than JPEG: the sticker is flat colour, so lossless comes out
// about four times smaller (roughly 60 KB against 230 KB a page at JPEG
// quality 0.92) and the QR modules stay exact. It costs some CPU in
// pdf-lib's re-compression, around 0.1 s a sticker.

import { PDFDocument } from "pdf-lib";
import {
  canvasToBlob,
  renderQrStickerCanvas,
  triggerDownload,
  type QrStickerArgs,
} from "./qrSticker";

export { triggerDownload };

// Sticker width in PDF points (1 pt = 1/72 in, 1 mm = 72 / 25.4 pt).
const MM = 72 / 25.4;
const PAGE_W = 105 * MM;

// Pre-printed stickers live for years, so their URL must not depend on
// whichever host the admin happens to be using when printing.
function qrBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_QR_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return window.location.origin;
}

// URL printed on a pool sticker; the database decides where it points.
export function stickerUrl(token: string): string {
  return `${qrBaseUrl()}/q/${token}`;
}

// URL printed on a named sticker for one machine (machine_kb.qr_token).
export function machineQrUrl(token: string): string {
  return `${qrBaseUrl()}/?qr=${encodeURIComponent(token)}`;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderStickerPng(args: QrStickerArgs): Promise<ArrayBuffer> {
  const canvas = await renderQrStickerCanvas(args);
  try {
    // Put white behind the transparent die-cut corners, which is what the
    // paper shows anyway, so the page image needs no alpha mask.
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.save();
    ctx.resetTransform();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    const blob = await canvasToBlob(canvas, "image/png");
    return await blob.arrayBuffer();
  } finally {
    // Zeroing the size frees the backing store now instead of at GC.
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function buildStickerPdf(
  items: QrStickerArgs[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const total = items.length;
  onProgress?.(0, total);

  for (let i = 0; i < total; i++) {
    const bytes = await renderStickerPng(items[i]);
    const image = await pdf.embedPng(bytes);
    // Embed now so pdf-lib frees the decoded pixels and keeps only the
    // compressed stream. Left to save(), 1000 stickers would hold several
    // GB of raw pixels at once.
    await image.embed();

    // Each page is exactly the sticker (105 mm wide at the artwork's own
    // aspect ratio, about 131 mm tall), so a print shop can use the page
    // edge as the trim size without stretching or white bands.
    const h = (image.height / image.width) * PAGE_W;
    const page = pdf.addPage([PAGE_W, h]);
    page.drawImage(image, { x: 0, y: 0, width: PAGE_W, height: h });

    onProgress?.(i + 1, total);
    await nextTick();
  }

  const out = await pdf.save({ addDefaultPage: false });
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

export async function downloadStickerPdf(
  items: QrStickerArgs[],
  filename: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const blob = await buildStickerPdf(items, onProgress);
  triggerDownload(blob, filename);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// RFC 4180 CSV: header code,url, CRLF line ends, UTF-8.
export function downloadStickerCsv(
  rows: { code: string; url: string }[],
  filename: string,
): void {
  const lines = [
    "code,url",
    ...rows.map((r) => `${csvField(r.code)},${csvField(r.url)}`),
  ];
  const blob = new Blob([`${lines.join("\r\n")}\r\n`], {
    type: "text/csv;charset=utf-8",
  });
  triggerDownload(blob, filename);
}
