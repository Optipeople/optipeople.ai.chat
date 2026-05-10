-- Two unrelated additions bundled because they're both small.
--
-- 1. Add 'webhook' as a fourth escalation channel. Operator click POSTs a
--    JSON snapshot to the configured URL — used by customers who want
--    programmatic ticket creation in their existing helpdesk system.
--    'service_ticket' stays put for the copy/paste fallback.
--
-- 2. Add `updated_at` on kb_documents so the ingestion watchdog can
--    detect docs that haven't progressed in a while and mark them failed.
--    Existing rows get the current timestamp as a backfill seed; the
--    application code bumps it explicitly on every status / progress
--    write (no trigger — keeps the lifecycle observable in code).

alter table escalation_targets
  drop constraint if exists escalation_targets_channel_check;

alter table escalation_targets
  add constraint escalation_targets_channel_check
  check (channel in ('phone','email','service_ticket','webhook'));

alter table escalations
  drop constraint if exists escalations_channel_check;

alter table escalations
  add constraint escalations_channel_check
  check (channel in ('phone','email','service_ticket','webhook'));

alter table kb_documents
  add column updated_at timestamptz not null default now();

create index kb_documents_updated_at_idx on kb_documents (updated_at);
