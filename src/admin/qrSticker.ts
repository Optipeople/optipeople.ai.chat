// Renders an A6 QR sticker (105 x 148 mm, 1200 x 1500 px, about 290 dpi)
// as a PNG and triggers a browser download. A downloaded image gives the
// operator a predictable file they can drop into Word, label-printer
// software, or print directly. Print engines mishandled the old
// window.print() flow, which is why this renders to canvas.
//
// Styled in the OptiPeople sales language (optipeople-design skill):
// IBM Plex Sans, headings at weight 400, the official wordmark top-left,
// primary green #024343, and the three brand lines along the bottom edge.
// At this canvas scale one CSS px is about 3 canvas px, so the 4px brand
// lines become 12px here.

import QRCode from "qrcode";

// The official wordmark from the brand kit. Loaded as an image, never
// redrawn, so it keeps the real letterforms and ring mask.
const LOGO_URL = "/brand/optipeople_logo_black.svg";
const LOGO_ASPECT = 1886 / 353;

const FONT_FAMILY = "OptiPeople Sticker Plex";
const FONT_STACK = `"${FONT_FAMILY}", "IBM Plex Sans", Arial, sans-serif`;

const COLOR = {
  primary: "#024343",
  foreground: "#0A0A0A",
  secondary: "rgba(10, 10, 10, 0.85)",
  muted: "#505E5E",
  border: "#E5E5E5",
  lineAmber: "#DBAB3B",
  lineSignal: "#37C245",
  lineGreen: "#024343",
} as const;

export type QrStickerArgs = {
  machineName: string;
  qrUrl: string;
  // Small label above the machine name, e.g. "Scan & spørg".
  eyebrow: string;
  // Instruction under the QR code. Wrapped to the content width.
  instruction: string;
};

let fontsReady: Promise<void> | null = null;

// Canvas only draws with fonts the document has loaded, so register the
// self-hosted IBM Plex Sans faces before drawing. A failure falls back
// to Arial rather than blocking the sticker.
function ensureFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = (async () => {
      try {
        const faces = [
          new FontFace(FONT_FAMILY, "url(/fonts/IBMPlexSans-Regular.ttf)", {
            weight: "400",
          }),
          new FontFace(FONT_FAMILY, "url(/fonts/IBMPlexSans-Medium.ttf)", {
            weight: "500",
          }),
        ];
        await Promise.all(faces.map((f) => f.load()));
        for (const f of faces) document.fonts.add(f);
      } catch (err) {
        console.warn("QR sticker: IBM Plex Sans failed to load", err);
      }
    })();
  }
  return fontsReady;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

function setTracking(ctx: CanvasRenderingContext2D, value: string): void {
  // letterSpacing is missing on older browsers. Tracking is a refinement,
  // so skip it there instead of failing.
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
      value;
  }
}

function trackingFor(size: number): string {
  return `${-(size * 0.025).toFixed(1)}px`;
}

function applyNameFont(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.font = `400 ${size}px ${FONT_STACK}`;
  setTracking(ctx, trackingFor(size));
}

// Operators give machines names of wildly varying lengths. Short names
// shrink to fit one line; longer ones wrap to at most two lines, and only
// a name too long even for that is cut with an ellipsis.
function layoutMachineName(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): { lines: string[]; size: number; lineHeight: number; tracking: string } {
  const result = (lines: string[], size: number) => ({
    lines,
    size,
    lineHeight: Math.round(size * 1.15),
    tracking: trackingFor(size),
  });

  for (let size = 112; size >= 80; size -= 4) {
    applyNameFont(ctx, size);
    if (ctx.measureText(text).width <= maxWidth) return result([text], size);
  }

  for (let size = 76; size >= 52; size -= 4) {
    applyNameFont(ctx, size);
    const lines = wrapLines(ctx, text, maxWidth);
    const fits =
      lines.length <= 2 &&
      lines.every((l) => ctx.measureText(l).width <= maxWidth);
    if (fits) return result(lines, size);
  }

  const size = 52;
  applyNameFont(ctx, size);
  const lines = wrapLines(ctx, text, maxWidth);
  const first = lines[0] ?? "";
  let second = lines.slice(1).join(" ");
  if (second) {
    while (second && ctx.measureText(`${second}…`).width > maxWidth) {
      second = second.slice(0, -1);
    }
    return result([first, `${second.trimEnd()}…`], size);
  }
  return result([first], size);
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function slug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 50);
}

async function renderQrStickerCanvas(
  args: QrStickerArgs,
): Promise<HTMLCanvasElement> {
  const W = 1200;
  const H = 1500;
  const M = 96; // outer margin and the one shared left line
  const contentW = W - 2 * M;
  const qrTop = 468;
  const qrSize = 720;

  const [, logoImg, qrImg] = await Promise.all([
    ensureFonts(),
    loadImage(LOGO_URL),
    QRCode.toDataURL(args.qrUrl, {
      width: qrSize,
      // The page margin supplies the quiet zone, so the modules can sit
      // on the same left line as the text.
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: COLOR.primary, light: "#FFFFFF" },
    }).then(loadImage),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  // Hairline at the trim edge so a white sticker printed on white paper
  // can still be cut out cleanly.
  ctx.strokeStyle = COLOR.border;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

  // Sender mark, top-left.
  const logoH = 64;
  ctx.drawImage(logoImg, M, M, logoH * LOGO_ASPECT, logoH);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Machine name: weight 400 with tight tracking. Size carries the
  // hierarchy, never bold. Its last baseline is fixed above the QR, so a
  // two-line name grows upwards and pushes the eyebrow up with it.
  const name = layoutMachineName(ctx, args.machineName, contentW);
  const nameBottom = 412;
  const firstBaseline = nameBottom - (name.lines.length - 1) * name.lineHeight;

  // Eyebrow: sentence case, medium weight, muted.
  ctx.fillStyle = COLOR.muted;
  ctx.font = `500 40px ${FONT_STACK}`;
  setTracking(ctx, "0px");
  ctx.fillText(args.eyebrow, M, firstBaseline - name.size - 4);

  ctx.fillStyle = COLOR.foreground;
  ctx.font = `400 ${name.size}px ${FONT_STACK}`;
  setTracking(ctx, name.tracking);
  name.lines.forEach((line, i) => {
    ctx.fillText(line, M, firstBaseline + i * name.lineHeight);
  });
  setTracking(ctx, "0px");

  // QR code in the primary green. No smoothing keeps module edges crisp.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrImg, M, qrTop, qrSize, qrSize);
  ctx.imageSmoothingEnabled = true;

  // Instruction in the secondary text colour.
  ctx.fillStyle = COLOR.secondary;
  ctx.font = `400 42px ${FONT_STACK}`;
  const lines = wrapLines(ctx, args.instruction, contentW).slice(0, 3);
  lines.forEach((line, i) => {
    ctx.fillText(line, M, qrTop + qrSize + 102 + i * 58);
  });

  // Brand lines, flush to the bottom edge, full width.
  const bar = 12;
  const barsTop = H - bar * 3;
  ctx.fillStyle = COLOR.lineAmber;
  ctx.fillRect(0, barsTop, W, bar);
  ctx.fillStyle = COLOR.lineSignal;
  ctx.fillRect(0, barsTop + bar, W, bar);
  ctx.fillStyle = COLOR.lineGreen;
  ctx.fillRect(0, barsTop + bar * 2, W, bar);

  return canvas;
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
  if (!blob) throw new Error("Kunne ikke generere PNG");
  return blob;
}

export async function renderQrStickerPngUrl(
  args: QrStickerArgs,
): Promise<string> {
  const canvas = await renderQrStickerCanvas(args);
  const blob = await canvasToBlob(canvas);
  return URL.createObjectURL(blob);
}

export async function downloadQrStickerPng(args: QrStickerArgs): Promise<void> {
  const canvas = await renderQrStickerCanvas(args);
  const blob = await canvasToBlob(canvas);

  const fileName = `qr-${slug(args.machineName) || "maskine"}.png`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
