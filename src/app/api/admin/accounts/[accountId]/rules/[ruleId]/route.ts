// PATCH  /api/admin/accounts/[accountId]/rules/[ruleId] — update body / enabled / position
// DELETE /api/admin/accounts/[accountId]/rules/[ruleId] — remove rule
//
// PATCH accepts any subset of { body, enabled, position }. Empty body
// is rejected; everything else is taken at face value (the UI is the
// only caller and it filters to the same rules).

import { getTranslations } from "next-intl/server";
import {
  deleteAccountAiRule,
  updateAccountAiRule,
} from "@/lib/aiRules";
import { AuthError, requireSuperAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RULE_BODY_LENGTH = 2000;

async function gate(req: Request): Promise<Response | null> {
  try {
    await requireSuperAdmin(req);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ accountId: string; ruleId: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { accountId, ruleId } = await ctx.params;
  const t = await getTranslations("server");

  let parsed: { body?: unknown; enabled?: unknown; position?: unknown };
  try {
    parsed = (await req.json()) as typeof parsed;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const patch: { body?: string; enabled?: boolean; position?: number } = {};

  if (parsed.body !== undefined) {
    if (typeof parsed.body !== "string") {
      return Response.json(
        { error: "body must be a string" },
        { status: 400 },
      );
    }
    const trimmed = parsed.body.trim();
    if (trimmed.length === 0) {
      return Response.json(
        { error: "Rule body cannot be empty" },
        { status: 400 },
      );
    }
    if (trimmed.length > MAX_RULE_BODY_LENGTH) {
      return Response.json(
        {
          error: `Rule body must be ${MAX_RULE_BODY_LENGTH} characters or fewer`,
        },
        { status: 400 },
      );
    }
    patch.body = trimmed;
  }

  if (parsed.enabled !== undefined) {
    if (typeof parsed.enabled !== "boolean") {
      return Response.json(
        { error: "enabled must be a boolean" },
        { status: 400 },
      );
    }
    patch.enabled = parsed.enabled;
  }

  if (parsed.position !== undefined) {
    if (
      typeof parsed.position !== "number" ||
      !Number.isFinite(parsed.position) ||
      parsed.position < 0
    ) {
      return Response.json(
        { error: "position must be a non-negative number" },
        { status: 400 },
      );
    }
    patch.position = Math.floor(parsed.position);
  }

  if (Object.keys(patch).length === 0) {
    return Response.json(
      { error: "No fields to update" },
      { status: 400 },
    );
  }

  try {
    const rule = await updateAccountAiRule({ accountId, ruleId, patch });
    return Response.json({ rule });
  } catch (err) {
    console.error("admin rules PATCH failed:", err);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ accountId: string; ruleId: string }> },
) {
  const denied = await gate(req);
  if (denied) return denied;

  const { accountId, ruleId } = await ctx.params;

  try {
    await deleteAccountAiRule({ accountId, ruleId });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("admin rules DELETE failed:", err);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}
