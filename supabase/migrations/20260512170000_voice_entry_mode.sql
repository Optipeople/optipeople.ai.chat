-- Allow conversations.entry_mode = 'voice' for realtime voice sessions.
alter table conversations drop constraint if exists conversations_entry_mode_check;
alter table conversations
  add constraint conversations_entry_mode_check
  check (entry_mode in ('qr','manual','deep_link','voice'));
