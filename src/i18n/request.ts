import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, locales, LOCALE_COOKIE } from "./config";

// Best-effort Accept-Language negotiation for first visits without a
// locale cookie — a Danish operator scanning a QR sticker on a fresh
// phone should land in Danish, not the English default.
function negotiateLocale(acceptLanguage: string | null): string | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => /^q=([\d.]+)$/.exec(p.trim())?.[1])
        .find(Boolean);
      return { tag: tag.toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
    const match = locales.find((l) => tag.startsWith(l));
    if (match) return match;
  }
  return null;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  let locale: string;
  if (isLocale(raw)) {
    locale = raw;
  } else {
    const headerStore = await headers();
    locale =
      negotiateLocale(headerStore.get("accept-language")) ?? defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
