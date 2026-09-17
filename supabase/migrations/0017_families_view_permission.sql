/* Adds a dedicated "View families" permission for the Families page (guardian
   accounts + linked children). Previously that page had no Level-1 permission
   gate at all — any admin-shaped user could reach it regardless of what their
   role profile actually granted. This brings it in line with every other
   "*.view" permission (students.view, teachers.view, academics.view, …),
   which are UI-visibility gates: the underlying data reads/writes already go
   through their own row-level checks (can_view_student / users.manage), this
   permission only controls whether the Families section (and its sidebar
   link) appears for a role.

   Defaults to Admin + Super Admin only, same rationale as 0010:
     - Super Admin bypasses per-permission checks (all_permissions).
     - Admin gets every permission except roles.manage, so it picks this up
       automatically via the insert below.
     - No other built-in role is granted it here — it can be turned on for
       any role from Roles & permissions in the app. */

insert into public.permissions (id, name, description, category) values
  ('families.view', 'View families', 'Browse guardian accounts and the children connected to them.', 'Staff')
on conflict (id) do nothing;

insert into public.role_permissions (role_def_id, permission_id)
values ('admin', 'families.view')
on conflict do nothing;
