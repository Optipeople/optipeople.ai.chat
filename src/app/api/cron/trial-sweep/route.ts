// GET /api/cron/trial-sweep: emails Optipeople (TRIAL_NOTIFY_EMAIL) and
// whoever set the trial, once, when an account's trial has run out.
// Nothing is blocked. Runs daily on a schedule (vercel.json).
//
// Authenticated by Vercel's cron secret: the platform sends
// `Authorization: Bearer $CRON_SECRET` with every scheduled invocation.

import { sweepExpiredTrials } from "@/lib/accountFlags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const appUrl = host ? `https://${host}` : null;
  try {
    const result = await sweepExpiredTrials({ appUrl });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("trial sweep failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
