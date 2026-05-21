// GET  /api/admin/accounts/[accountId]/rules — system rule + admin rules
// POST /api/admin/accounts/[accountId]/rules — append a new admin rule
//
// The locked system rule lives in code (src/lib/aiRules.ts) and is
// returned alongside the editable list so the admin UI can render it
// read-only without a separate fetch.

import { getTranslations } from "next-intl/server";
import {
  createAccountAiRule,
  listAccountAiRules,
  SYSTEM_RULE_BODY,
  type AccountAiRule,
} from "@/lib/aiRules";
import { AuthError, assertAccountAccess, requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Maximum length of a single admin-authored rule. Long enough for a
// detailed paragraph, short enough that the prompt doesn't balloon if
// someone pastes a manual into the field by mistake.
const MAX_RULE_BODY_LENGTH = 2000;

export type AdminAiRulesResponse = {
  systemRule: string;
  rules: AccountAiRule[];
};

async function gate(
  req: Request,
  accountId: string,
): Promise<Response | null> {
  try {
    const admin = await requireAdmin(req);
    assertAccountAccess(admin, accountId);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;
  const denied = await gate(req, accountId);
  if (denied) return denied;
  try {
    const rules = await listAccountAiRules(accountId);
    const body: AdminAiRulesResponse = {
      systemRule: SYSTEM_RULE_BODY,
      rules,
    };
    return Response.json(body);
  } catch (err) {
    console.error("admin rules GET failed:", err);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;
  const denied = await gate(req, accountId);
  if (denied) return denied;

  const t = await getTranslations("server");

  let parsed: { body?: unknown };
  try {
    parsed = (await req.json()) as typeof parsed;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const body =
    typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (body.length === 0) {
    return Response.json(
      { error: "Rule body is required" },
      { status: 400 },
    );
  }
  if (body.length > MAX_RULE_BODY_LENGTH) {
    return Response.json(
      {
        error: `Rule body must be ${MAX_RULE_BODY_LENGTH} characters or fewer`,
      },
      { status: 400 },
    );
  }

  try {
    const rule = await createAccountAiRule({ accountId, body });
    return Response.json({ rule });
  } catch (err) {
    console.error("admin rules POST failed:", err);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}
