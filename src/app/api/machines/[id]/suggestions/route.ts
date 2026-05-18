// GET /api/machines/[id]/suggestions?lang=en|da
//
// Public — returns the cached starter questions for a machine's chat
// empty state in the requested locale. The chat itself is gated by QR
// token or Optipeople login, and these questions leak no sensitive data
// (they're operator-friendly phrasings of manual content), so we mirror
// /api/qr/resolve and skip auth here. Empty array = client falls back to
// broad generic prompts.

import { defaultLocale, isLocale } from "@/i18n/config";
import { getSuggestedQuestions } from "@/lib/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SuggestionsResponse = {
  suggestions: string[];
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return Response.json({ error: "machine id is required" }, { status: 400 });
  }
  const langParam = new URL(req.url).searchParams.get("lang");
  const locale = isLocale(langParam) ? langParam : defaultLocale;
  const suggestions = await getSuggestedQuestions(id, locale);
  const body: SuggestionsResponse = { suggestions };
  return Response.json(body);
}
