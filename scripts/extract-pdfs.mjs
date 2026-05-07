// Pre-Phase-1 knowledge extraction: walks knowledgebase/ for PDFs, extracts
// text via pdf-parse, writes data/knowledge.json. The chat route reads from
// that file at startup. This script is a placeholder — Phase 1's per-machine
// Supabase ingestion will replace it.

import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const KNOWLEDGEBASE_DIR = join(ROOT, "knowledgebase");
const OUTPUT_FILE = join(ROOT, "data", "knowledge.json");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      files.push(path);
    }
  }
  return files;
}

async function main() {
  console.log(`Scanning ${KNOWLEDGEBASE_DIR}...`);
  const pdfs = await walk(KNOWLEDGEBASE_DIR);
  console.log(`Found ${pdfs.length} PDF(s).`);

  const documents = [];
  for (const path of pdfs) {
    const rel = relative(KNOWLEDGEBASE_DIR, path).replace(/\\/g, "/");
    const { size } = await stat(path);
    process.stdout.write(`  Extracting ${rel} (${(size / 1e6).toFixed(1)} MB)... `);
    try {
      const buf = await readFile(path);
      const { text, numpages } = await pdfParse(buf);
      const cleaned = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      documents.push({ path: rel, pages: numpages, text: cleaned });
      console.log(`${numpages}p, ${cleaned.length} chars`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  const totalChars = documents.reduce((n, d) => n + d.text.length, 0);
  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify({ documents }, null, 2));
  console.log(
    `\nWrote ${OUTPUT_FILE}: ${documents.length} docs, ${totalChars.toLocaleString()} total chars (~${Math.round(totalChars / 4).toLocaleString()} tokens)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
