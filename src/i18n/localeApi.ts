// Client-side helpers for the /api/user/locale endpoint. Keep these
// thin — the route handler does the DB upsert and cookie write, this
// module just types the calls.

import type { Locale } from "./config";

export async function fetchStoredLocale(email: string): Promise<Locale | null> {
  const res = await fetch(
    `/api/user/locale?email=${encodeURIComponent(email)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { locale: Locale | null };
  return body.locale;
}

export async function persistLocale(
  locale: Locale,
  email: string | null,
): Promise<void> {
  await fetch("/api/user/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale, email }),
  });
}
