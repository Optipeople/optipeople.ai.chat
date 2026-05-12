-- Replace the 'phone' escalation channel with 'sms'.
--
-- The old 'phone' channel was a client-side tel: deep-link — it created
-- an audit row but did not notify the receiving tech; the operator had
-- to manually place the call. We've replaced it with 'sms', which sends
-- a real text via Twilio carrying the share URL. The wire format of the
-- `target` column is the same (an E.164 phone number), but the semantics
-- on the server are now active rather than passive.
--
-- No prod data uses 'phone' yet, so we drop those rows outright rather
-- than rewriting them. The check constraint is rebuilt to swap the
-- allowed values; both `escalation_targets.channel` and
-- `escalations.channel` are affected.

delete from escalation_targets where channel = 'phone';
delete from escalations where channel = 'phone';

alter table escalation_targets
  drop constraint if exists escalation_targets_channel_check;

alter table escalation_targets
  add constraint escalation_targets_channel_check
  check (channel in ('sms','email','service_ticket','webhook'));

alter table escalations
  drop constraint if exists escalations_channel_check;

alter table escalations
  add constraint escalations_channel_check
  check (channel in ('sms','email','service_ticket','webhook'));
