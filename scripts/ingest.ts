// Per-machine ingestion CLI.
//
// Usage:
//   npm run ingest -- --machine-id <uuid> --account-id <uuid> \
//       [--machine-name <name>] [<pdf-or-dir>...]
//
// Each PDF: original uploaded to Supabase Storage, text extracted, chunked,
// embedded via Voyage voyage-4-large, written to kb_chunks. machine_kb +
// kb_documents rows are upserted/inserted along the way.
//
// This is the same logic that will live behind the admin UI's "upload"
// endpoint in iteration 2 — keep it in this file until then.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { embedDocuments, VOYAGE_MODEL } from "../src/lib/voyage.ts";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

type Args = {
  machineId?: string;
  accountId?: string;
  machineName?: string;
  reset?: boolean;
  paths: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = { paths: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--machine-id") args.machineId = argv[++i];
    else if (a === "--account-id") args.accountId = argv[++i];
    else if (a === "--machine-name") args.machineName = argv[++i];
    else if (a === "--reset") args.reset = true;
    else args.paths.push(a);
  }
  return args;
}

async function walkPdfs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkPdfs(p)));
    else if (e.name.toLowerCase().endsWith(".pdf")) out.push(p);
  }
  return out;
}

// Recursive splitter: tries the most natural break points first
// (paragraph → newline → sentence → hard char split). Then a second
// merging pass packs the small pieces back up to ~target chars with
// ~overlap chars of trailing context shared into the next chunk.
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

function chunkText(text: string, target = 3500, overlap = 400): string[] {
  const pieces = splitRecursive(text, target).filter((p) => p.trim());
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const sep = current ? "\n\n" : "";
    if (current.length + sep.length + piece.length > target && current) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + "\n\n" + piece;
    } else {
      current += sep + piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.machineId || !args.accountId) {
    console.error(
      "Usage: npm run ingest -- --machine-id <uuid> --account-id <uuid> [--machine-name <name>] [<pdf-or-dir>...]",
    );
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Make sure machine_kb row exists. Safe to upsert — repeated runs just
  // refresh display_name.
  {
    const { error } = await supabase.from("machine_kb").upsert(
      {
        machine_id: args.machineId,
        account_id: args.accountId,
        display_name: args.machineName ?? null,
      },
      { onConflict: "machine_id" },
    );
    if (error) {
      console.error("machine_kb upsert failed:", error);
      process.exit(1);
    }
  }

  // --reset wipes existing documents + chunks for this machine before
  // re-ingesting. Storage objects under the machine prefix are best-effort
  // cleaned too. Useful while iterating on the chunker.
  if (args.reset) {
    console.log(`Resetting existing KB for machine ${args.machineId}…`);
    const { data: oldDocs } = await supabase
      .from("kb_documents")
      .select("id, storage_path")
      .eq("machine_id", args.machineId);

    if (oldDocs && oldDocs.length > 0) {
      const paths = oldDocs
        .map((d) => d.storage_path)
        .filter((p): p is string => !!p);
      if (paths.length > 0) {
        await supabase.storage.from("kb-documents").remove(paths);
      }
      // kb_chunks is wiped automatically by ON DELETE CASCADE.
      const { error } = await supabase
        .from("kb_documents")
        .delete()
        .eq("machine_id", args.machineId);
      if (error) {
        console.error("reset failed:", error);
        process.exit(1);
      }
      console.log(`  cleared ${oldDocs.length} documents`);
    } else {
      console.log("  nothing to clear");
    }
  }

  // Resolve PDF list — explicit paths, directories, or default to knowledgebase/.
  const pdfPaths: string[] = [];
  if (args.paths.length === 0) {
    pdfPaths.push(...(await walkPdfs("knowledgebase")));
  } else {
    for (const p of args.paths) {
      const s = await stat(p);
      if (s.isDirectory()) pdfPaths.push(...(await walkPdfs(p)));
      else pdfPaths.push(p);
    }
  }

  console.log(
    `Ingesting ${pdfPaths.length} PDF(s) for machine ${args.machineId}`,
  );

  for (const pdfPath of pdfPaths) {
    const fileName = basename(pdfPath);
    const title = fileName.replace(/\.pdf$/i, "");
    console.log(`\n=== ${fileName} ===`);

    const buf = await readFile(pdfPath);
    const { size } = await stat(pdfPath);

    const docId = randomUUID();
    const storagePath = `${args.machineId}/${docId}.pdf`;

    console.log(`  uploading ${(size / 1e6).toFixed(2)} MB → ${storagePath}`);
    const { error: uploadError } = await supabase.storage
      .from("kb-documents")
      .upload(storagePath, buf, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError) {
      console.error("  upload failed:", uploadError);
      continue;
    }

    console.log("  extracting text…");
    const { text, numpages } = await pdfParse(buf);
    const cleaned = text
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    console.log(`  ${numpages} pages, ${cleaned.length} chars`);

    const { error: docError } = await supabase.from("kb_documents").insert({
      id: docId,
      machine_id: args.machineId,
      title,
      // CLI uses the title as a placeholder summary — the admin UI in
      // iteration 2 will let humans write a proper one-line manifest entry.
      summary: title,
      source_type: "pdf",
      storage_path: storagePath,
      byte_size: size,
      page_count: numpages,
      status: "embedding",
      created_by: "cli",
    });
    if (docError) {
      console.error("  kb_documents insert failed:", docError);
      continue;
    }

    const chunks = chunkText(cleaned);
    console.log(`  chunked into ${chunks.length} pieces`);

    console.log("  embedding via Voyage…");
    const embeddings = await embedDocuments(chunks);
    if (embeddings.length !== chunks.length) {
      console.error(
        `  embedding count mismatch (${embeddings.length} vs ${chunks.length})`,
      );
      continue;
    }

    const rows = chunks.map((chunkTextValue, i) => ({
      document_id: docId,
      machine_id: args.machineId,
      ordinal: i,
      page_from: null,
      page_to: null,
      text: chunkTextValue,
      embedding: embeddings[i],
      embedding_model: VOYAGE_MODEL,
    }));

    // Insert in batches to keep payloads sane.
    const BATCH = 50;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await supabase.from("kb_chunks").insert(slice);
      if (error) {
        console.error(`  kb_chunks insert failed at offset ${i}:`, error);
        break;
      }
      inserted += slice.length;
    }
    console.log(`  inserted ${inserted}/${rows.length} chunks`);

    await supabase
      .from("kb_documents")
      .update({ status: "ready" })
      .eq("id", docId);
    console.log("  ready ✓");
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
