// GET  /api/user/consent → current ConsentStatus for the authenticated user.
// POST /api/user/consent { acceptTerms, acceptPrivacy, acceptAnalytics }
//      → upserts a row per document. Versions are pinned server-side from
//        src/lib/consent.ts so the client can't lie about what it accepted.
//
// QR-session operators don't hit this route — they're rate-limited to the
// dismissable banner stored in localStorage. The mandatory consent gate
// only applies to Optipeople-authenticated users where we have a stable
// email to bind acceptance to.

import { AuthError, resolveCurrentUser } from "@/lib/auth";
import {
  ANALYTICS_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
  computeNeedsConsent,
  isConsentDocument,
  type ConsentDocument,
  type ConsentRecord,
  type ConsentStatus,
} from "@/lib/consent";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConsentRow = {
  document: string;
  version: string;
  accepted: boolean;
  accepted_at: string;
};

function rowToRecord(row: ConsentRow): ConsentRecord | null {
  if (!isConsentDocument(row.document)) return null;
  return {
    document: row.document,
    version: row.version,
    accepted: row.accepted,
    acceptedAt: row.accepted_at,
  };
}

async function loadStatus(email: string): Promise<ConsentStatus> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_consent")
    .select("document, version, accepted, accepted_at")
    .eq("email", email);

  if (error) {
    console.error("loadStatus user_consent failed:", error);
    throw new Error("Database error");
  }

  const byDoc: Record<ConsentDocument, ConsentRecord | null> = {
    terms: null,
    privacy: null,
    analytics: null,
  };
  for (const raw of (data ?? []) as ConsentRow[]) {
    const rec = rowToRecord(raw);
    if (rec) byDoc[rec.document] = rec;
  }

  return {
    terms: byDoc.terms,
    privacy: byDoc.privacy,
    analytics: byDoc.analytics,
    needsConsent: computeNeedsConsent(byDoc.terms, byDoc.privacy),
  };
}

export async function GET(req: Request) {
  let email: string;
  try {
    const user = await resolveCurrentUser(req);
    email = user.email.toLowerCase();
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  try {
    const status = await loadStatus(email);
    return Response.json(status);
  } catch {
    return Response.json({ error: "Database error" }, { status: 500 });
  }
}

type PostBody = {
  acceptTerms?: unknown;
  acceptPrivacy?: unknown;
  acceptAnalytics?: unknown;
};

export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof resolveCurrentUser>>;
  try {
    user = await resolveCurrentUser(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  const email = user.email.toLowerCase();

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.acceptTerms !== true || body.acceptPrivacy !== true) {
    return Response.json(
      { error: "Terms and privacy must both be accepted" },
      { status: 400 },
    );
  }
  const acceptAnalytics = body.acceptAnalytics === true;

  // Forwarded IP first (Vercel/proxies); fall back to remote address. We
  // store this for audit purposes — the GDPR-relevant field is "when the
  // user actively confirmed acceptance", and IP is the conventional proof.
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const userAgent = req.headers.get("user-agent");

  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();

  const rows = [
    {
      email,
      document: "terms" as const,
      version: TERMS_VERSION,
      accepted: true,
      accepted_at: now,
      ip_address: ipAddress,
      user_agent: userAgent,
    },
    {
      email,
      document: "privacy" as const,
      version: PRIVACY_VERSION,
      accepted: true,
      accepted_at: now,
      ip_address: ipAddress,
      user_agent: userAgent,
    },
    {
      email,
      document: "analytics" as const,
      version: ANALYTICS_VERSION,
      accepted: acceptAnalytics,
      accepted_at: now,
      ip_address: ipAddress,
      user_agent: userAgent,
    },
  ];

  const { error } = await supabase
    .from("user_consent")
    .upsert(rows, { onConflict: "email,document" });

  if (error) {
    console.error("POST /api/user/consent upsert failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  try {
    const status = await loadStatus(email);
    return Response.json(status);
  } catch {
    return Response.json({ error: "Database error" }, { status: 500 });
  }
}
