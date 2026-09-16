/* Adds a dedicated permission for managing academic years & terms/semesters.
   Previously this was folded into the broad "academics.manage" permission
   (which also covers classes/sections/assignments) — this splits it out so
   a school can grant "manage classes" without also granting "restructure
   the academic calendar", and vice versa.

   Defaults to Admin + Super Admin only:
     - Super Admin already bypasses per-permission checks (all_permissions).
     - Admin gets every permission except roles.manage, so it picks this up
       automatically via the insert below.
     - No other built-in role (coordinator/teacher/student/guardian) is
       granted it here — same as any other permission, it can be turned on
       for any role from Roles & permissions in the app. */

insert into public.permissions (id, name, description, category) values
  ('academics.manage_years', 'Manage academic years & terms', 'Create academic years, set the active year, and manage semesters/terms.', 'Academics')
on conflict (id) do nothing;

insert into public.role_permissions (role_def_id, permission_id)
values ('admin', 'academics.manage_years')
on conflict do nothing;

drop policy if exists years_wri on public.academic_years;
create policy years_wri on public.academic_years
  for all to authenticated
  using (public.has_perm('academics.manage_years'))
  with check (public.has_perm('academics.manage_years'));

drop policy if exists terms_wri on public.terms;
create policy terms_wri on public.terms
  for all to authenticated
  using (public.has_perm('academics.manage_years'))
  with check (public.has_perm('academics.manage_years'));
