// Renders an A6-ish QR sticker as a high-DPI PNG and triggers a
// browser download. Replaces the old window.print() flow — print
// engines mishandled the clipPath in the Optipeople logo, and a
// downloaded image gives the operator a predictable file they can
// drop into Word, label-printer software, or print directly.

import QRCode from "qrcode";

// Inline copy of OptipeopleLogo with `currentColor` resolved to black,
// so the rasterized image renders in the right colour without needing
// CSS context. Keep these paths in sync with src/components/logo.tsx.
const LOGO_SVG_BLACK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164.07 30.74" fill="black">
  <defs>
    <clipPath id="optipeople-logo-clip" transform="translate(-.93 -.67)">
      <circle cx="15.42" cy="15.16" r="10.16" fill="none" />
    </clipPath>
  </defs>
  <path d="M54.37 15.1a12.94 12.94 0 0 1-.95 5.07 8.51 8.51 0 0 1-4.2 4.4 10.79 10.79 0 0 1-4.94.94 11 11 0 0 1-3.51-.62 8.17 8.17 0 0 1-4-3.1 10.49 10.49 0 0 1-1.7-5.08 15.33 15.33 0 0 1 .25-4.87 8.79 8.79 0 0 1 4.46-6.16 9.89 9.89 0 0 1 4.09-1.11 11 11 0 0 1 4.55.63 8.5 8.5 0 0 1 4.59 4 12.37 12.37 0 0 1 1.36 5.9zm-15.3 0a10.62 10.62 0 0 0 .52 3.43 5.12 5.12 0 0 0 2 2.64 5.25 5.25 0 0 0 2.91.81 5 5 0 0 0 5-3.14 8.69 8.69 0 0 0 .69-3.63 9.11 9.11 0 0 0-.8-4.15 4.86 4.86 0 0 0-2.3-2.39 6 6 0 0 0-3.47-.46 4.72 4.72 0 0 0-3.85 2.86 9.49 9.49 0 0 0-.7 4.03zm94.3 8.04v5.48a2 2 0 0 1-1.13 1.91 1.13 1.13 0 0 1-.5.16h-2.33v-.26q0-7 0-14a9.94 9.94 0 0 1 .42-3.11 4.93 4.93 0 0 1 2.64-3 9.4 9.4 0 0 1 5.17-1 7.15 7.15 0 0 1 4 1.53 5.52 5.52 0 0 1 1.4 1.94 10.68 10.68 0 0 1 .87 5.32 9.41 9.41 0 0 1-.88 3.65 5.86 5.86 0 0 1-3.24 3.19 5.66 5.66 0 0 1-5.06-.43 3.86 3.86 0 0 1-1.33-1.42zm6.61-6c0-.23 0-.64-.09-1.05a4.64 4.64 0 0 0-1-2.53 3.08 3.08 0 0 0-5 1 8.07 8.07 0 0 0-.39 3.68 4.75 4.75 0 0 0 .92 2.52 3 3 0 0 0 4.83-.21 6.18 6.18 0 0 0 .73-3.37zm-52.65.79v7.12h-4.09a2.64 2.64 0 0 1 0-.28V7.39a2.09 2.09 0 0 1 1.18-2.06 2.47 2.47 0 0 1 1-.19q3.63 0 7.26 0a6.2 6.2 0 0 1 3.4.95 5 5 0 0 1 2.15 3.24 9.51 9.51 0 0 1 0 4.56 5 5 0 0 1-4.27 3.91 10.84 10.84 0 0 1-1.71.12h-4.53zm0-3.61h.19 3.74a6.19 6.19 0 0 0 1.05-.08 2.17 2.17 0 0 0 1.87-1.44 4.06 4.06 0 0 0 0-2.6 1.92 1.92 0 0 0-1.11-1.31 4.3 4.3 0 0 0-1.62-.29h-4.1zm-28.09 8.81v1.77 3.73a2 2 0 0 1-2.11 2.1h-1.81v-.3-14a10 10 0 0 1 .41-3.1 4.88 4.88 0 0 1 2.63-3 9.5 9.5 0 0 1 5.17-1 7.27 7.27 0 0 1 3.94 1.47 5.52 5.52 0 0 1 1.47 2 10 10 0 0 1 .91 4.34 10.49 10.49 0 0 1-.92 4.69A5.84 5.84 0 0 1 65.68 25a5.6 5.6 0 0 1-5.06-.46 6.56 6.56 0 0 1-1.07-1 3 3 0 0 1-.25-.37zm0-5.83a7.61 7.61 0 0 0 .32 2.36 3.1 3.1 0 0 0 3.62 2.21 2.79 2.79 0 0 0 2.2-1.89 7.19 7.19 0 0 0 0-5.34 2.87 2.87 0 0 0-2.41-1.9 3 3 0 0 0-3.17 1.65 6.94 6.94 0 0 0-.56 2.94zm43.77 1.09a4.12 4.12 0 0 0 .8 2.6 2.72 2.72 0 0 0 2 1 3.5 3.5 0 0 0 2.12-.47 2.09 2.09 0 0 0 .54-.49 1.57 1.57 0 0 1 1.25-.7h3.15l-.45 1.22a6.25 6.25 0 0 1-4.94 3.67 8.23 8.23 0 0 1-4.26-.3 6 6 0 0 1-3.35-3 10.58 10.58 0 0 1-1-5.6 8.84 8.84 0 0 1 .86-3.49 6 6 0 0 1 4.79-3.44 8.82 8.82 0 0 1 4.11.34 5.94 5.94 0 0 1 3.77 3.6 12.12 12.12 0 0 1 .67 4.8c0 .24-.12.26-.32.26h-9.76zm0-2.62h5.87c-.09-1.86-.93-3.12-2.95-3.11a2.86 2.86 0 0 0-2.86 3.11zm50.97 2.62a3.89 3.89 0 0 0 1 2.85 2.51 2.51 0 0 0 1.41.69 3.55 3.55 0 0 0 2.43-.39 2.37 2.37 0 0 0 .6-.54 1.55 1.55 0 0 1 1.21-.67h3.18l-.45 1.22a6.25 6.25 0 0 1-4.94 3.67 8.12 8.12 0 0 1-4.23-.3 6.05 6.05 0 0 1-3.4-3 9.84 9.84 0 0 1-1-4.72 9.93 9.93 0 0 1 .64-3.78 6 6 0 0 1 5.12-4 8.94 8.94 0 0 1 4 .33 5.92 5.92 0 0 1 3.81 3.58 12.07 12.07 0 0 1 .7 4.84c0 .22-.11.26-.32.26h-9.76zm5.88-2.62c-.1-2-1-3.24-3.23-3.1a2.82 2.82 0 0 0-2.62 3.1zm-31.38 1.49a10.3 10.3 0 0 1-.79 4.21 6 6 0 0 1-4.09 3.56 8.16 8.16 0 0 1-5.49-.38 5.61 5.61 0 0 1-3.32-3.82 12.44 12.44 0 0 1-.28-5.94 6.89 6.89 0 0 1 2.24-4.12 6 6 0 0 1 3-1.36 8.9 8.9 0 0 1 4 .21 6 6 0 0 1 3.74 3.25 9.93 9.93 0 0 1 .99 4.39zm-10.26.14a10.33 10.33 0 0 0 .41 2.65 2.82 2.82 0 0 0 3.11 2 2.7 2.7 0 0 0 2.24-1.78 7.94 7.94 0 0 0 .17-5.52 3.12 3.12 0 0 0-1.44-1.74 3 3 0 0 0-4 1.33 7.09 7.09 0 0 0-.49 3.06zM70.73 5.15h2.38a1.91 1.91 0 0 1 1.6 1.8v2.38.35h2.36a2.87 2.87 0 0 1-.42 2.07 2.24 2.24 0 0 1-1.95.73v8.39c0 .82.32 1.15 1.15 1.16h1.22v3a8.7 8.7 0 0 1-.89 0c-1.16 0-2.33-.05-3.49-.14a2 2 0 0 1-1.85-1.72 7.44 7.44 0 0 1-.12-1.24V5.15zm74.14 0h2.41a1.85 1.85 0 0 1 1.62 1.73v18.17h-4zm-66.8 19.9V9.7a21 21 0 0 1 2.51 0 1.85 1.85 0 0 1 1.52 1.73v.4 13.2zm4.07-16.72h-4V5.16h2.43a1.88 1.88 0 0 1 1.59 1.77l-.02 1.4z" />
  <g clip-path="url(#optipeople-logo-clip)">
    <path d="M4.6 11.9s2.6-3.12 5 2.21c2.21 4.89 3.64.58 3.64.58l.73-2h10.45 2.88v2.43H15.12s-2.07 7.4-5.84 3.35c0 0-2.65-3-4-2.1s.41 4.05 1.86 5.21l-2.07 2.2S.21 16.47 4.6 11.9z" fill="black" />
  </g>
  <circle cx="14.49" cy="14.49" r="12.29" fill="none" stroke="black" stroke-width="4.416" />
</svg>`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

async function svgToImage(svgString: string): Promise<HTMLImageElement> {
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Picks a font size that fits `text` within `maxWidth`. Operators give
// machines names of wildly varying lengths; auto-fit beats truncation.
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initial: number,
  weight: string,
  family: string,
  minSize = 32,
): number {
  let size = initial;
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 4;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
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

export async function downloadQrStickerPng(args: {
  machineName: string;
  qrUrl: string;
}): Promise<void> {
  const W = 1200;
  const H = 1500;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // White background.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, W, H);

  // Card border — leave a comfortable margin so the file can be cut /
  // trimmed to size when printed on adhesive label stock.
  const margin = 40;
  ctx.strokeStyle = "black";
  ctx.lineWidth = 6;
  drawRoundedRect(ctx, margin, margin, W - margin * 2, H - margin * 2, 32);
  ctx.stroke();

  // Logo — centered near the top, sized to ~90px tall, preserving the
  // logo's native 164.07:30.74 aspect ratio.
  const logoImg = await svgToImage(LOGO_SVG_BLACK);
  const logoH = 90;
  const logoW = logoH * (164.07 / 30.74);
  ctx.drawImage(logoImg, (W - logoW) / 2, 110, logoW, logoH);

  // "SCAN & SPØRG" caption — letter-spaced uppercase, mid-grey.
  ctx.textAlign = "center";
  ctx.fillStyle = "#737373";
  ctx.font = '500 30px "Helvetica Neue", Arial, sans-serif';
  // Manual letter-spacing: split chars and offset.
  const caption = "S C A N   &   S P Ø R G";
  ctx.fillText(caption, W / 2, 280);

  // Machine name — large bold, auto-shrinks for long names.
  ctx.fillStyle = "black";
  const nameSize = fitFontSize(
    ctx,
    args.machineName,
    W - 2 * margin - 80,
    72,
    "700",
    '"Helvetica Neue", Arial, sans-serif',
    36,
  );
  ctx.font = `700 ${nameSize}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(args.machineName, W / 2, 380);

  // QR code — render via the qrcode lib at high resolution, then draw.
  const qrSize = 720;
  const qrDataUrl = await QRCode.toDataURL(args.qrUrl, {
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: "M",
  });
  const qrImg = await loadImage(qrDataUrl);
  ctx.drawImage(qrImg, (W - qrSize) / 2, 440, qrSize, qrSize);

  // Instruction lines below the QR.
  ctx.fillStyle = "black";
  ctx.font = '400 28px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(
    "Scan koden med kameraet på din telefon",
    W / 2,
    1240,
  );
  ctx.fillText(
    "og stil dit spørgsmål direkte til Opti Assist.",
    W / 2,
    1280,
  );

  // Trigger download.
  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
  if (!blob) throw new Error("Kunne ikke generere PNG");

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
