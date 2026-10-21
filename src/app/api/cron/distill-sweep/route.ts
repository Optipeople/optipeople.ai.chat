// GET /api/cron/distill-sweep — turns conversations that went quiet into
// knowledge (src/lib/distill.ts). Runs on a schedule (vercel.json).
// Operator-confirmed chats are published into the machine's KB; the rest
// wait in kb_insights for an admin to review.
//
// Authenticated by Vercel's cron secret: the platform sends
// `Authorization: Bearer $CRON_SECRET` with every scheduled invocation.

import { sweepConversationsForDistillation } from "@/lib/distill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// One distillation is a single model call of a few seconds; stop picking
// new ones well before the platform's 300 s.
const SWEEP_BUDGET_MS = 240_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const result = await sweepConversationsForDistillation({
      deadlineAt: startedAt + SWEEP_BUDGET_MS,
      limit: 20,
    });
    return Response.json({ ok: true, ...result, ms: Date.now() - startedAt });
  } catch (err) {
    console.error("distill sweep failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
