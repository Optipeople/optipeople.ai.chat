import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// End-to-end readiness check. Hits each external dependency well enough to
// catch misconfigured env vars or missing schema, without doing heavy work.
// Keep this lightweight — it can be polled by uptime checks.
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // Anthropic + Voyage keys: presence only, never echo values.
  checks.anthropic_key = { ok: !!process.env.ANTHROPIC_API_KEY };
  checks.voyage_key = { ok: !!process.env.VOYAGE_API_KEY };
  checks.optipeople_target = {
    ok: !!process.env.OPTIPEOPLE_API_TARGET,
    detail: process.env.OPTIPEOPLE_API_TARGET ?? undefined,
  };

  // Supabase: real round-trip. Count rows in machine_kb — proves
  // env → service-role auth → schema migration are all in place.
  try {
    const supabase = getSupabaseServerClient();
    const { count, error } = await supabase
      .from("machine_kb")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    checks.supabase = {
      ok: true,
      detail: `machine_kb rows: ${count ?? 0}`,
    };
  } catch (err) {
    checks.supabase = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return Response.json(
    { ok: allOk, checks },
    { status: allOk ? 200 : 503 },
  );
}
