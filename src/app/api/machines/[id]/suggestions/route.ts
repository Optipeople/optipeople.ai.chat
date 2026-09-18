// GET /api/machines/[id]/suggestions?lang=en|da
//
// Returns the cached starter questions for a machine's chat empty state
// in the requested locale. Gated like every other operator route: an
// Optipeople bearer must belong to the machine's account (or hold full
// access), and a QR token must resolve to this very machine. The
// questions are derived from manual content, so they reveal which
// equipment and manuals a customer has — not sensitive on their own, but
// not for other tenants either. Empty array = client falls back to broad
// generic prompts.

import { defaultLocale, isLocale } from "@/i18n/config";
import {
  assertOperatorAccountAccess,
  AuthError,
  resolveCurrentUser,
  resolveMachineAccountId,
} from "@/lib/auth";
import { readQrTokenFromRequest, resolveQrToken } from "@/lib/qrAuth";
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

  const hasBearer = /^Bearer\s/i.test(req.headers.get("authorization") ?? "");
  const url = new URL(req.url);
  const qrToken =
    readQrTokenFromRequest(req, null) ?? url.searchParams.get("qrToken");

  try {
    if (hasBearer) {
      const user = await resolveCurrentUser(req);
      const accountId = await resolveMachineAccountId(id);
      // Unknown machine and cross-tenant machine look the same from the
      // outside so ids can't be confirmed by probing.
      if (!accountId) throw new AuthError(404, "Machine not found");
      try {
        assertOperatorAccountAccess(user, accountId);
      } catch {
        throw new AuthError(404, "Machine not found");
      }
    } else if (qrToken) {
      const session = await resolveQrToken(qrToken);
      if (!session || session.machineId !== id) {
        throw new AuthError(401, "Invalid or revoked QR token");
      }
    } else {
      throw new AuthError(401, "Missing or malformed Authorization header");
    }
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const langParam = url.searchParams.get("lang");
  const locale = isLocale(langParam) ? langParam : defaultLocale;
  const suggestions = await getSuggestedQuestions(id, locale);
  const body: SuggestionsResponse = { suggestions };
  return Response.json(body);
}
