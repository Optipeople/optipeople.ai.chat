-- conversations.user_email / user_name — denormalised at create time so
-- the audit list can render attribution without hitting Optipeople for
-- every row. user_id (their UUID) stays as the canonical join key.

alter table conversations
  add column user_email text,
  add column user_name  text;

create index conversations_user_email_idx on conversations (user_email);
