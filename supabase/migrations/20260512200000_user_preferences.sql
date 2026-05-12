-- Per-user app preferences. Keyed by Optipeople email since auth is
-- delegated to Optipeople and we don't have our own users table. Stays
-- in sync across devices: cookie is the per-request source of truth,
-- this table seeds the cookie at login time.

create table user_preferences (
  email      text primary key,
  locale     text not null default 'en',
  updated_at timestamptz not null default now()
);
