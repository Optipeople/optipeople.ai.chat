-- Machines can now be onboarded into Opti Assist before they exist in
-- the Optipeople portal (the "New account" wizard creates them locally).
--
-- machine_id stays the primary key and is what every local table hangs
-- off. For portal-onboarded machines it equals the Optipeople machine id
-- (unchanged behaviour); wizard-created machines get a generated id.
-- portal_machine_id carries the Optipeople machine id when the machine
-- is linked to the portal — null means "not linked yet". MCP guidance in
-- chat is scoped by portal_machine_id, so unlinked machines get KB-only
-- answers until an admin links them.

alter table machine_kb add column portal_machine_id text;

-- Every existing row was onboarded from the portal, so its machine_id
-- is the portal id.
update machine_kb set portal_machine_id = machine_id;

-- A portal machine can be linked to at most one local machine.
create unique index machine_kb_portal_machine_id_key
  on machine_kb (portal_machine_id)
  where portal_machine_id is not null;
