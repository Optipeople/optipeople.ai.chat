// One-shot CLI to regenerate bilingual chat suggestions for every machine.
//
// Run after applying 20260518120000_machine_suggestions_i18n.sql so the
// new jsonb column gets populated with English + Danish question pools
// for each machine_kb row. Safe to re-run; calls the same
// regenerateSuggestedQuestions path the ingestion flow uses.
//
// Usage:
//   npm run regenerate-suggestions [-- --machine-id <uuid>]

import { regenerateSuggestedQuestions } from "../src/lib/suggestions.ts";
import { getSupabaseServerClient } from "../src/lib/supabase.ts";

type Args = { machineId?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--machine-id") args.machineId = argv[++i];
  }
  return args;
}

async function listMachineIds(only?: string): Promise<string[]> {
  if (only) return [only];
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("machine_kb")
    .select("machine_id");
  if (error) throw new Error(`machine_kb read failed: ${error.message}`);
  return (data ?? [])
    .map((row) => (row as { machine_id: string | null }).machine_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function main() {
  const args = parseArgs(process.argv);
  const ids = await listMachineIds(args.machineId);
  if (ids.length === 0) {
    console.log("No machine_kb rows found.");
    return;
  }
  console.log(`Regenerating bilingual suggestions for ${ids.length} machine(s)…`);
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      const bundle = await regenerateSuggestedQuestions(id);
      const counts = Object.entries(bundle)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(" ");
      console.log(`  ✓ ${id}  (${counts})`);
      ok++;
    } catch (err) {
      console.warn(
        `  ✗ ${id}  ${err instanceof Error ? err.message : err}`,
      );
      fail++;
    }
  }
  console.log(`Done. ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
