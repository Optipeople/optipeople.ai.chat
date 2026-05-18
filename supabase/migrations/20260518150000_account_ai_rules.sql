-- Admin-editable rules injected into the Opti Assist system prompt for every
-- chat in a given Optipeople account. Used to keep the assistant on
-- topic and to encode account-specific guidance ("always remind operators
-- to lock out the spindle before tool changes", etc.).
--
-- The locked baseline rule that resists jailbreak attempts and pins the
-- assistant to the knowledge base lives in src/lib/aiRules.ts as a
-- constant — it isn't stored here. Keeping it in code means it cannot be
-- corrupted by data edits and stays identical across accounts.
--
-- account_id is text to match every other Optipeople-id reference in the
-- schema (escalation_targets, machine_kb, account_mcp_config, …).

create table account_ai_rules (
  id            uuid primary key default gen_random_uuid(),
  account_id    text not null,
  body          text not null,
  -- Sort key for rendering rules in the prompt. Lower position renders
  -- first. We don't enforce uniqueness — gaps and ties are fine, the
  -- UI re-numbers on edit.
  position      integer not null default 0,
  -- Disabled rules stay in the table (so admins can re-enable without
  -- retyping) but are excluded from the system prompt at chat time.
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table account_ai_rules enable row level security;

-- The chat route hot-path filter: every chat turn fetches enabled rules
-- for the active account, ordered by position. A composite index covers
-- the equality + range scan cleanly.
create index account_ai_rules_account_idx
  on account_ai_rules (account_id, enabled, position);
