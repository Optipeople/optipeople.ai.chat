// Renders an A6 QR sticker (105 x 148 mm, 1200 x 1500 px, about 290 dpi)
// as a PNG and triggers a browser download. A downloaded image gives the
// operator a predictable file they can drop into Word, label-printer
// software, or print directly. Print engines mishandled the old
// window.print() flow, which is why this renders to canvas.
//
// Styled in the OptiPeople sales language (optipeople-design skill):
// IBM Plex Sans, headings at weight 400, the official wordmark top-left,
// a deep green header field, and the three brand lines along the bottom
// edge. The QR sits on a white card that overlaps the header, drawn with
// rounded modules and finder patterns. Below it, OptiPeople's support
// phone and email give the operator somewhere to turn if the scan fails.
// At this canvas scale one CSS px is about 3 canvas px, so the 4px brand
// lines become 12px here.

import QRCode from "qrcode";

// The official wordmark from the brand kit. Loaded as an image, never
// redrawn, so it keeps the real letterforms and ring mask. White, since
// it sits on the green header field.
const LOGO_URL = "/brand/optipeople_logo_white.svg";
const LOGO_ASPECT = 1886 / 353;

const FONT_FAMILY = "OptiPeople Sticker Plex";
const FONT_STACK = `"${FONT_FAMILY}", "IBM Plex Sans", Arial, sans-serif`;

const COLOR = {
  primary: "#024343",
  mint: "#A3EEC8",
  foreground: "#0A0A0A",
  secondary: "#364646",
  muted: "#5D6B6B",
  border: "#E5E5E5",
  cardBorder: "#DCE3E3",
  chip: "#EAEEEE",
  lineAmber: "#DBAB3B",
  lineSignal: "#37C245",
  lineGreen: "#024343",
} as const;

export type QrStickerArgs = {
  machineName: string;
  qrUrl: string;
  // Small label above the machine name, e.g. "Scan & spørg".
  eyebrow: string;
  // Instruction under the QR code. Wrapped to the card width.
  instruction: string;
  // Lead-in above the support contacts, e.g. "Problemer? Kontakt …".
  supportLabel: string;
  supportPhone: string;
  supportEmail: string;
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

  for (let size = 96; size >= 72; size -= 4) {
    applyNameFont(ctx, size);
    if (ctx.measureText(text).width <= maxWidth) return result([text], size);
  }

  for (let size = 68; size >= 48; size -= 4) {
    applyNameFont(ctx, size);
    const lines = wrapLines(ctx, text, maxWidth);
    const fits =
      lines.length <= 2 &&
      lines.every((l) => ctx.measureText(l).width <= maxWidth);
    if (fits) return result(lines, size);
  }

  const size = 48;
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

// Lucide "phone" and "mail" (24 x 24 viewBox), stroked like the app's
// own icons so the sticker and the screen speak the same language.
const PHONE_PATHS = [
  "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384",
];
const MAIL_PATHS = [
  "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",
  "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
];

function drawIcon(
  ctx: CanvasRenderingContext2D,
  paths: string[],
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of paths) ctx.stroke(new Path2D(d));
  ctx.restore();
}

// Draws the QR from its module matrix instead of a library bitmap, so the
// data modules can be soft rounded squares and the three finder patterns
// rounded frames. Modules fill 88% of a cell and the finders keep their
// 1:1:3:1:1 ratio, which keeps the code easy for phone cameras to read.
function drawQr(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / n;
  const inFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

  ctx.fillStyle = color;
  const dot = cell * 0.88;
  const inset = (cell - dot) / 2;
  ctx.beginPath();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c) || inFinder(r, c)) continue;
      ctx.roundRect(
        x + c * cell + inset,
        y + r * cell + inset,
        dot,
        dot,
        dot * 0.32,
      );
    }
  }
  ctx.fill();

  const finders: [number, number][] = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ];
  for (const [r, c] of finders) {
    const fx = x + c * cell;
    const fy = y + r * cell;
    // Outer 7x7 frame, one module thick.
    ctx.beginPath();
    ctx.roundRect(fx, fy, cell * 7, cell * 7, cell * 2);
    ctx.roundRect(fx + cell, fy + cell, cell * 5, cell * 5, cell * 1.2);
    ctx.fill("evenodd");
    // Inner 3x3 eye.
    ctx.beginPath();
    ctx.roundRect(fx + cell * 2, fy + cell * 2, cell * 3, cell * 3, cell * 0.9);
    ctx.fill();
  }
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
  const headerH = 700;
  const cardTop = 452;
  const cardH = 780;
  const cardR = 40;
  const qrSize = 560;
  const qrTop = cardTop + 56;

  const [, logoImg] = await Promise.all([ensureFonts(), loadImage(LOGO_URL)]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);

  // Deep green header field.
  ctx.fillStyle = COLOR.primary;
  ctx.fillRect(0, 0, W, headerH);

  // Sender mark, top-left, white on the dark field.
  const logoH = 56;
  ctx.drawImage(logoImg, M, 88, logoH * LOGO_ASPECT, logoH);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Machine name: weight 400 with tight tracking. Size carries the
  // hierarchy, never bold. Its last baseline is fixed above the card, so
  // a two-line name grows upwards and pushes the eyebrow up with it.
  const name = layoutMachineName(ctx, args.machineName, contentW);
  const nameBottom = 372;
  const firstBaseline = nameBottom - (name.lines.length - 1) * name.lineHeight;

  // Eyebrow: sentence case, medium weight, mint on the dark field.
  ctx.fillStyle = COLOR.mint;
  ctx.font = `500 36px ${FONT_STACK}`;
  setTracking(ctx, "0px");
  ctx.fillText(args.eyebrow, M, firstBaseline - name.size - 8);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `400 ${name.size}px ${FONT_STACK}`;
  setTracking(ctx, name.tracking);
  name.lines.forEach((line, i) => {
    ctx.fillText(line, M, firstBaseline + i * name.lineHeight);
  });
  setTracking(ctx, "0px");

  // White card straddling the header edge. A soft shadow lifts it off
  // the green; the hairline keeps its edge visible on the white half.
  ctx.save();
  ctx.shadowColor = "rgba(1, 54, 54, 0.22)";
  ctx.shadowBlur = 56;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.roundRect(M, cardTop, contentW, cardH, cardR);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = COLOR.cardBorder;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(M + 1, cardTop + 1, contentW - 2, cardH - 2, cardR - 1);
  ctx.stroke();

  // QR in the primary green, centred in the card. The card padding
  // supplies the quiet zone.
  drawQr(ctx, args.qrUrl, (W - qrSize) / 2, qrTop, qrSize, COLOR.primary);

  // Instruction, centred under the code.
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.secondary;
  ctx.font = `400 36px ${FONT_STACK}`;
  wrapLines(ctx, args.instruction, contentW - 160)
    .slice(0, 2)
    .forEach((line, i) => {
      ctx.fillText(line, W / 2, qrTop + qrSize + 66 + i * 48);
    });
  ctx.textAlign = "left";

  // Support contacts: a muted lead-in, then phone and email side by side,
  // each behind a round icon chip.
  ctx.fillStyle = COLOR.muted;
  ctx.font = `500 30px ${FONT_STACK}`;
  ctx.fillText(args.supportLabel, M, 1312);

  const rowY = 1344;
  const chip = 64;
  ctx.font = `500 34px ${FONT_STACK}`;
  let cx = M;
  const contacts: [string[], string][] = [
    [PHONE_PATHS, args.supportPhone],
    [MAIL_PATHS, args.supportEmail],
  ];
  for (const [paths, label] of contacts) {
    ctx.fillStyle = COLOR.chip;
    ctx.beginPath();
    ctx.arc(cx + chip / 2, rowY + chip / 2, chip / 2, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(ctx, paths, cx + 18, rowY + 18, 28, COLOR.primary);
    ctx.fillStyle = COLOR.foreground;
    ctx.fillText(label, cx + chip + 20, rowY + chip / 2 + 12);
    cx += chip + 20 + ctx.measureText(label).width + 56;
  }

  // Hairline at the trim edge so a white sticker printed on white paper
  // can still be cut out cleanly.
  ctx.strokeStyle = COLOR.border;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

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
