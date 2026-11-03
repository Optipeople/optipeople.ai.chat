-- Partner accounts do not exist in Optipeople (Partner is a user role),
-- so the partner flag added in 20261103120000 is not needed.

alter table account_flags drop constraint account_flags_partner_not_trial;
alter table account_flags drop column is_partner;
