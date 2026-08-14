-- Escalations get a lightweight handled/unhandled workflow so the admin
-- inbox can triage service calls instead of treating them as a
-- read-only log. `status` defaults to 'open' for existing and new rows;
-- marking a row handled stamps who did it and when (cleared on reopen).

alter table escalations
  add column status     text not null default 'open' check (status in ('open','handled')),
  add column handled_at timestamptz,
  add column handled_by text;

-- The global escalation inbox lists open rows newest-first by default.
create index escalations_status_created_idx on escalations (status, created_at desc);
