-- Per-user record of which end-user legal documents they've accepted.
-- One row per (email, document). Bumping the version constant in
-- src/lib/consent.ts makes the existing row stale and triggers a re-prompt.
--
-- Acceptance is captured against the Optipeople email since that's the
-- only stable identity we have (no local users table). QR-session
-- operators don't go through this table — they see a banner stored
-- in localStorage and are accountable under the customer's master
-- contract, not as individual data subjects.

create table user_consent (
  email        text not null,
  document     text not null,            -- 'terms' | 'privacy' | 'analytics'
  version      text not null,            -- mirrors a constant in src/lib/consent.ts
  accepted     boolean not null,         -- true for mandatory docs; true/false for analytics
  accepted_at  timestamptz not null default now(),
  ip_address   inet,
  user_agent   text,
  primary key (email, document)
);

-- Document values are constrained at the application layer (see
-- src/lib/consent.ts CONSENT_DOCUMENTS). A check constraint here would
-- have to be migrated every time we add an optional consent type, so
-- we keep it loose.
