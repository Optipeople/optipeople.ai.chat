// Per-account trial flag (table account_flags). The portal has no field
// for it, so it lives here. No row means a paying,
// active customer account.
//
// Trial is informational only: nothing is gated on it. When it runs out
// the daily trial sweep emails Optipeople once.

import { getSupabaseServerClient } from "./supabase";
import { sendEmail } from "./email";
import { todayUtc } from "./trialDates";

export type AccountFlags = {
  accountId: string;
  // ISO date (YYYY-MM-DD), the last day of the trial. Null when not on trial.
  trialEndsAt: string | null;
  trialSetAt: string | null;
  trialSetByEmail: string | null;
  trialSetByName: string | null;
};

type Row = {
  account_id: string;
  account_name: string | null;
  trial_ends_at: string | null;
  trial_set_at: string | null;
  trial_set_by_email: string | null;
  trial_set_by_name: string | null;
  trial_expiry_notified_at: string | null;
};

const COLUMNS =
  "account_id, account_name, trial_ends_at, trial_set_at, trial_set_by_email, trial_set_by_name, trial_expiry_notified_at";

function toFlags(row: Row): AccountFlags {
  return {
    accountId: row.account_id,
    trialEndsAt: row.trial_ends_at,
    trialSetAt: row.trial_set_at,
    trialSetByEmail: row.trial_set_by_email,
    trialSetByName: row.trial_set_by_name,
  };
}

export function defaultFlags(accountId: string): AccountFlags {
  return {
    accountId,
    trialEndsAt: null,
    trialSetAt: null,
    trialSetByEmail: null,
    trialSetByName: null,
  };
}

export async function listAccountFlags(): Promise<AccountFlags[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from("account_flags").select(COLUMNS);
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toFlags);
}

export async function getAccountFlags(accountId: string): Promise<AccountFlags> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("account_flags")
    .select(COLUMNS)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  return data ? toFlags(data as Row) : defaultFlags(accountId);
}

export type AccountFlagsPatch = {
  // Null removes the trial. Undefined leaves it as it is.
  trialEndsAt?: string | null;
};

export async function updateAccountFlags(
  accountId: string,
  patch: AccountFlagsPatch,
  actor: { email: string; name: string | null },
  accountName: string | null,
): Promise<AccountFlags> {
  const supabase = getSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("account_flags")
    .select(COLUMNS)
    .eq("account_id", accountId)
    .maybeSingle();
  if (readError) throw readError;
  const current = existing as Row | null;

  const trialEndsAt =
    patch.trialEndsAt !== undefined
      ? patch.trialEndsAt
      : (current?.trial_ends_at ?? null);

  const trialChanged = trialEndsAt !== (current?.trial_ends_at ?? null);
  const row: Partial<Row> & { account_id: string; updated_at: string } = {
    account_id: accountId,
    account_name: accountName ?? current?.account_name ?? null,
    trial_ends_at: trialEndsAt,
    updated_at: new Date().toISOString(),
  };
  if (trialChanged) {
    row.trial_expiry_notified_at = null;
    if (trialEndsAt === null) {
      row.trial_set_at = null;
      row.trial_set_by_email = null;
      row.trial_set_by_name = null;
    } else if (!current?.trial_ends_at) {
      // Only a fresh trial records who set it. Moving the end date keeps
      // the original setter as the one who gets the expiry email.
      row.trial_set_at = new Date().toISOString();
      row.trial_set_by_email = actor.email;
      row.trial_set_by_name = actor.name;
    }
  }

  const { data, error } = await supabase
    .from("account_flags")
    .upsert(row, { onConflict: "account_id" })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toFlags(data as Row);
}

export type TrialSweepResult = {
  expired: number;
  notified: number;
  failed: number;
};

// Emails Optipeople (TRIAL_NOTIFY_EMAIL) and whoever set the trial, once
// per expired trial. Each row is claimed (notified_at set) before any
// email goes out, so overlapping runs and partial failures never send
// twice. Only when every send fails is the claim released for a retry.
export async function sweepExpiredTrials(
  opts: { appUrl: string | null; now?: Date },
): Promise<TrialSweepResult> {
  const now = opts.now ?? new Date();
  const appUrl = opts.appUrl?.replace(/\/$/, "") ?? null;
  const supabase = getSupabaseServerClient();
  const today = todayUtc(now);
  const { data, error } = await supabase
    .from("account_flags")
    .select(COLUMNS)
    .not("trial_ends_at", "is", null)
    .is("trial_expiry_notified_at", null)
    .lt("trial_ends_at", today);
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  const inbox = process.env.TRIAL_NOTIFY_EMAIL?.trim() || null;
  let notified = 0;
  let failed = 0;

  for (const row of rows) {
    const recipients = Array.from(
      new Set(
        [inbox, row.trial_set_by_email?.trim() || null].filter(
          (r): r is string => !!r,
        ),
      ),
    );
    if (recipients.length === 0) {
      console.warn(
        `trial sweep: no recipient for ${row.account_id}; set TRIAL_NOTIFY_EMAIL`,
      );
      failed++;
      continue;
    }

    const name = row.account_name ?? row.account_id;
    const lines = [
      `The Opti Assist trial for ${name} ended on ${row.trial_ends_at}.`,
      "",
      `Account ID: ${row.account_id}`,
      row.trial_set_by_email
        ? `Trial set by: ${row.trial_set_by_name ?? row.trial_set_by_email} (${row.trial_set_by_email})`
        : null,
      "",
      "Nothing has been blocked. The account keeps working until someone acts on it.",
      appUrl
        ? `Account settings: ${appUrl}/admin/accounts/${encodeURIComponent(row.account_id)}`
        : null,
    ].filter((l): l is string => l !== null);

    const { data: claimed, error: claimError } = await supabase
      .from("account_flags")
      .update({ trial_expiry_notified_at: new Date().toISOString() })
      .eq("account_id", row.account_id)
      .eq("trial_ends_at", row.trial_ends_at)
      .is("trial_expiry_notified_at", null)
      .select("account_id");
    if (claimError) {
      console.error(`trial sweep: claim failed for ${row.account_id}:`, claimError);
      failed++;
      continue;
    }
    // Another run got it first, or the trial changed since the read.
    if (!claimed || claimed.length === 0) continue;

    let sent = 0;
    for (const to of recipients) {
      try {
        await sendEmail({
          to,
          subject: `Opti Assist trial ended: ${name}`,
          text: lines.join("\n"),
        });
        sent++;
      } catch (err) {
        console.error(
          `trial sweep: email to ${to} failed for ${row.account_id}:`,
          err,
        );
      }
    }
    if (sent > 0) {
      notified++;
    } else {
      failed++;
      await supabase
        .from("account_flags")
        .update({ trial_expiry_notified_at: null })
        .eq("account_id", row.account_id)
        .eq("trial_ends_at", row.trial_ends_at);
    }
  }

  return { expired: rows.length, notified, failed };
}
