// GET   /api/admin/accounts/[accountId]/flags: the account's partner and
//       trial flags (defaults when nothing is set).
// PATCH /api/admin/accounts/[accountId]/flags: set or clear them.
//
// Super admins and partners may set or remove a trial. Only super admins
// (not partners) may mark an account as a partner account. A partner
// account can never be on trial.

import { getTranslations } from "next-intl/server";
import {
  AccountFlagsConflict,
  getAccountFlags,
  updateAccountFlags,
  type AccountFlags,
  type AccountFlagsPatch,
} from "@/lib/accountFlags";
import { AuthError, isStrictSuperAdmin, requireSuperAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date (no 2026-02-30) in a sane range.
function isValidTrialDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === value &&
    value >= "2020-01-01" &&
    value <= "2100-12-31"
  );
}

export type AccountFlagsResponse = { flags: AccountFlags };

export type UpdateAccountFlagsRequest = AccountFlagsPatch & {
  // Display name from the portal, stored so the expiry email can name
  // the account.
  accountName?: string | null;
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }
  try {
    const body: AccountFlagsResponse = {
      flags: await getAccountFlags(accountId),
    };
    return Response.json(body);
  } catch (err) {
    console.error("account flags GET failed:", err);
    const t = await getTranslations("server");
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await ctx.params;
  let user;
  try {
    user = await requireSuperAdmin(req);
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse();
    throw err;
  }

  const t = await getTranslations("server");
  let body: UpdateAccountFlagsRequest;
  try {
    body = (await req.json()) as UpdateAccountFlagsRequest;
  } catch {
    return Response.json({ error: t("invalidJson") }, { status: 400 });
  }

  const patch: AccountFlagsPatch = {};
  if (body.isPartner !== undefined) {
    if (typeof body.isPartner !== "boolean") {
      return Response.json({ error: "isPartner must be a boolean" }, { status: 400 });
    }
    if (!isStrictSuperAdmin(user.permissionName)) {
      return Response.json({ error: t("unauthorized") }, { status: 403 });
    }
    patch.isPartner = body.isPartner;
  }
  if (body.trialEndsAt !== undefined) {
    if (body.trialEndsAt !== null && !isValidTrialDate(body.trialEndsAt)) {
      return Response.json({ error: t("invalidTrialDate") }, { status: 400 });
    }
    patch.trialEndsAt = body.trialEndsAt;
  }
  const accountName =
    typeof body.accountName === "string" && body.accountName.trim()
      ? body.accountName.trim().slice(0, 200)
      : null;

  try {
    const flags = await updateAccountFlags(
      accountId,
      patch,
      { email: user.email, name: user.name },
      accountName,
    );
    const res: AccountFlagsResponse = { flags };
    return Response.json(res);
  } catch (err) {
    if (err instanceof AccountFlagsConflict) {
      return Response.json(
        {
          error:
            err.reason === "removeTrialFirst"
              ? t("trialRemoveFirst")
              : t("partnerNoTrial"),
        },
        { status: 409 },
      );
    }
    console.error("account flags PATCH failed:", err);
    return Response.json({ error: t("dbError") }, { status: 500 });
  }
}
