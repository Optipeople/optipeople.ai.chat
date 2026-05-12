// Converts every .md in this folder to a PDF in ./pdfs/ using marked + Edge headless.
//
// Run with:   npx -y -p marked@^15 node demo-data/cnc-drilling/build-pdfs.mjs
//
// Output: demo-data/cnc-drilling/pdfs/*.pdf, one per source .md (README skipped).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "pdfs");
const TMP_DIR = join(HERE, ".tmp-html");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) {
  console.error("Microsoft Edge not found. Install Edge or edit EDGE_CANDIDATES.");
  process.exit(1);
}

const CSS = `
  @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
  html { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         font-size: 10.5pt; color: #1a1a1a; }
  body { margin: 0; line-height: 1.45; }
  h1 { font-size: 22pt; margin: 0 0 6pt; border-bottom: 2px solid #222; padding-bottom: 6pt; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; color: #0a4d8c; }
  h3 { font-size: 12pt; margin: 14pt 0 4pt; color: #333; }
  h4 { font-size: 10.5pt; margin: 12pt 0 4pt; color: #555; }
  p  { margin: 4pt 0 6pt; }
  ul, ol { margin: 4pt 0 8pt; padding-left: 20pt; }
  li { margin: 1pt 0; }
  code { font-family: "Consolas", "Courier New", monospace; font-size: 9.5pt;
         background: #f4f4f4; padding: 1pt 3pt; border-radius: 2pt; }
  pre  { font-family: "Consolas", "Courier New", monospace; font-size: 8.5pt;
         background: #f4f4f4; padding: 8pt; border-radius: 4pt; overflow: visible;
         white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
  pre code { background: transparent; padding: 0; }
  table { border-collapse: collapse; margin: 6pt 0 12pt; width: 100%;
          page-break-inside: avoid; }
  th, td { border: 1px solid #bbb; padding: 4pt 6pt; text-align: left;
           vertical-align: top; font-size: 9.5pt; }
  th { background: #eef3f8; font-weight: 600; }
  blockquote { margin: 6pt 0; padding: 4pt 10pt; border-left: 3px solid #999;
               color: #444; background: #f8f8f8; }
  hr { border: none; border-top: 1px solid #ccc; margin: 14pt 0; }
  a { color: #0a4d8c; text-decoration: none; }
  .footer { position: fixed; bottom: 8mm; left: 16mm; right: 16mm;
            font-size: 8pt; color: #888; border-top: 1px solid #ddd;
            padding-top: 4pt; display: flex; justify-content: space-between; }
`;

function wrap(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>${title}</title><style>${CSS}</style></head>
<body>${body}
<div class="footer"><span>Optipeople DemoCNC D-2800M — demo material</span>
<span>${title}</span></div></body></html>`;
}

const files = readdirSync(HERE)
  .filter((f) => f.endsWith(".md") && f !== "00-README.md")
  .sort();

console.log(`Converting ${files.length} markdown files → PDF`);
console.log(`Using Edge at: ${edge}`);

let success = 0;
for (const file of files) {
  const md = readFileSync(join(HERE, file), "utf8");
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : basename(file, ".md");
  const html = wrap(title, marked.parse(md));

  const htmlPath = join(TMP_DIR, file.replace(/\.md$/, ".html"));
  const pdfPath  = join(OUT_DIR, file.replace(/\.md$/, ".pdf"));
  writeFileSync(htmlPath, html, "utf8");

  console.log(`  → ${basename(pdfPath)}`);
  const result = spawnSync(
    edge,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file:///${htmlPath.replace(/\\/g, "/")}`,
    ],
    { stdio: "inherit" },
  );
  if (result.status === 0 && existsSync(pdfPath)) success++;
  else console.error(`    FAILED (exit=${result.status})`);
}

console.log(`\nDone: ${success}/${files.length} PDFs written to ${OUT_DIR}`);
