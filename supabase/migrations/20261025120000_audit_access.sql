-- Audit: staff the owner trusts with the shop's audit documents and sales records. Owners always have it.
-- Only the API changes it (owner only); shoppers and staff can't set it on their own profile (see the column grants).
alter table public.profiles add column if not exists can_audit boolean not null default false;
