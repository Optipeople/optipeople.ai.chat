-- Per-account commercial flags that the Optipeople portal has no field
-- for: "partner account" and "trial".
--
-- No row means the default: a paying, active customer account. Trial is
-- informational only. Nothing is blocked when it runs out; a daily cron
-- (/api/cron/trial-sweep) emails Optipeople once and the admin account
-- list shows the account as expired.
--
-- A partner account can never be on trial. The API enforces that, and
-- the check constraint backs it up.
--
-- RLS is on with no policies, so only the service role touches it.

create table account_flags (
  account_id               text primary key,
  -- Copied from the portal when a flag is set, so the cron can name the
  -- account in its email without a portal token.
  account_name             text,
  is_partner               boolean not null default false,
  -- Last day of the trial (inclusive). Null means not on trial.
  trial_ends_at            date,
  trial_set_at             timestamptz,
  trial_set_by_email       text,
  trial_set_by_name        text,
  -- Set when the expiry email went out. Cleared when the end date
  -- changes, so an extended trial is reported again when it runs out.
  trial_expiry_notified_at timestamptz,
  updated_at               timestamptz not null default now(),
  constraint account_flags_partner_not_trial
    check (not (is_partner and trial_ends_at is not null))
);

create index account_flags_trial_pending_idx
  on account_flags (trial_ends_at)
  where trial_ends_at is not null and trial_expiry_notified_at is null;

alter table account_flags enable row level security;
