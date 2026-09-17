/* Adds a "View children's fees" permission so guardians get a proper Fees
   entry in their own sidebar (linking to a ledger across all their
   registered children), instead of fee ledgers only being reachable one
   child's profile at a time.

   Guardians could already read their own children's fee_items via RLS
   (fees_sel policy checks guardian_students, not any permission) — this
   permission is purely the Level-1 UI gate for the new /guardian/fees nav
   item and page, consistent with results.view_children /
   attendance.view_children.

   Granted to:
     - guardian (so the nav item appears for every guardian by default)
     - admin (admin gets every permission except roles.manage; explicit
       here because admin's original grant ran once, at seed time, and a
       permission added later doesn't retroactively backfill it) */

insert into public.permissions (id, name, description, category) values
  ('fees.view_children', 'View children''s fees', 'See and pay fees for registered children.', 'Fees')
on conflict (id) do nothing;

insert into public.role_permissions (role_def_id, permission_id)
values ('guardian', 'fees.view_children'), ('admin', 'fees.view_children')
on conflict do nothing;
