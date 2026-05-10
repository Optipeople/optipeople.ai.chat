-- Phase 4: Escalation.
--
-- Two changes:
--
-- 1. New table `escalation_targets`, keyed on `account_id`. One row per
--    Optipeople account, configured by super-admins. The chat
--    "Tilkald service" button reads from this; if no row exists for the
--    account, the button surfaces a "service ikke konfigureret" hint
--    rather than firing.
--
-- 2. Add share-token columns to the existing `escalations` table so a
--    service tech can open the transcript without an Optipeople login.
--    The token IS the auth (mirrors machine_kb.qr_token); the row stores
--    a 30-day soft expiry, enforced server-side at lookup. `created_by`
--    captures the operator who escalated for audit; `note` is an
--    optional free-text passed to the receiving tech.

create table escalation_targets (
  account_id  text primary key,
  -- 'phone'    → operator client opens tel:<target>
  -- 'email'    → operator client opens mailto:<target> with shareUrl in body
  -- 'service_ticket' → no native open; share URL is shown for copy/paste
  --   into whatever ticketing the customer uses
  channel     text not null check (channel in ('phone','email','service_ticket')),
  target      text not null,
  -- Display label shown to the operator at confirm time, e.g. "Felder service".
  label       text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table escalation_targets enable row level security;

alter table escalations
  add column share_token text unique,
  add column share_token_created_at timestamptz,
  add column expires_at timestamptz,
  add column created_by text,
  add column note text;

-- Lookup by conversation_id is hot in the audit drilldown.
create index escalations_conversation_idx on escalations (conversation_id);
