// Per-machine ingestion CLI.
//
// Usage:
//   npm run ingest -- --machine-id <uuid> --account-id <uuid> \
//       [--machine-name <name>] [--reset] [<pdf-or-dir>...]
//
// Thin wrapper around src/lib/ingestion.ts. The same pipeline runs behind
// the admin UI's upload endpoint in iteration 2, so changes to chunking,
// embedding, or DB writes belong in the lib — not here.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import {
  ensureMachineKb,
  ingestPdf,
  resetMachineKb,
} from "../src/lib/ingestion.ts";

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

async function main() {
  const args = parseArgs(process.argv);
  if (!args.machineId || !args.accountId) {
    console.error(
      "Usage: npm run ingest -- --machine-id <uuid> --account-id <uuid> [--machine-name <name>] [--reset] [<pdf-or-dir>...]",
    );
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
    process.exit(1);
  }

  await ensureMachineKb(args.machineId, args.accountId, args.machineName);

  if (args.reset) {
    console.log(`Resetting existing KB for machine ${args.machineId}…`);
    const cleared = await resetMachineKb(args.machineId);
    console.log(cleared > 0 ? `  cleared ${cleared} documents` : "  nothing to clear");
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
    console.log(`\n=== ${fileName} ===`);

    try {
      const buf = await readFile(pdfPath);
      const result = await ingestPdf({
        machineId: args.machineId,
        accountId: args.accountId,
        machineName: args.machineName,
        fileName,
        fileBuffer: buf,
        createdBy: "cli",
      });
      console.log(
        `  ${result.pageCount} pages, ${result.chunkCount} chunks, ${(
          result.byteSize / 1e6
        ).toFixed(2)} MB → ready ✓`,
      );
    } catch (err) {
      console.error(`  failed: ${err instanceof Error ? err.message : err}`);
      // Continue with the remaining PDFs — matches the prior CLI behaviour
      // where a per-doc failure didn't abort the whole batch.
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
