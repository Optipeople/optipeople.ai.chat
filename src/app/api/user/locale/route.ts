// GET  /api/user/locale?email=...  → { locale }
// POST /api/user/locale { locale, email? } → sets NEXT_LOCALE cookie and
//   (when email is provided) upserts the preference so it follows the
//   user across devices. QR-token operators can call without an email
//   and still get cookie persistence.

import { cookies } from "next/headers";
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  type Locale,
} from "@/i18n/config";
import { getSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1 year — locale is sticky until the user changes it.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim();
  if (!email) {
    return Response.json({ locale: null });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_preferences")
    .select("locale")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("GET /api/user/locale failed:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }

  const locale = isLocale(data?.locale) ? data!.locale : null;
  return Response.json({ locale });
}

export async function POST(request: Request) {
  let body: { locale?: unknown; email?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isLocale(body.locale)) {
    return Response.json({ error: "Invalid locale" }, { status: 400 });
  }
  const locale: Locale = body.locale;
  const email =
    typeof body.email === "string" && body.email.trim()
      ? body.email.trim().toLowerCase()
      : null;

  if (email) {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("user_preferences")
      .upsert(
        { email, locale, updated_at: new Date().toISOString() },
        { onConflict: "email" },
      );
    if (error) {
      console.error("POST /api/user/locale upsert failed:", error);
      return Response.json({ error: "Database error" }, { status: 500 });
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    maxAge: COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });

  return Response.json({ locale, defaultLocale });
}
