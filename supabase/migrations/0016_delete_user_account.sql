/* Bug fix: the Users & Roles page has always shown a "Delete" button (Trash2
   icon) that just did `d.users = d.users.filter(...)` on the client. In live
   mode that never reached the server at all — there was no RPC and no RLS
   delete policy on public.profiles (delete requires an admin-privileged
   operation on auth.users, same reasoning as create_user_account), so the
   account silently reappeared the next time the app reconnected/hydrated.
   The toast said "User deleted." regardless.

   This adds a real, server-side delete_user_account RPC — the deletion
   counterpart to create_user_account — gated the same way (users.manage),
   with the same self-delete / last-admin guards the client already has, as
   defense in depth.

   One more wrinkle a plain `delete from auth.users` runs into: most audit
   trail columns (mark_audit.entered_by, mark_submissions.submitted_by /
   approved_by / returned_by / published_by, attendance_registers.recorded_by,
   messages.sender_id, message_reports.reporter_id, events.created_by,
   audit_log.actor_id, …) reference public.profiles(id) with NO explicit
   "on delete" action, i.e. RESTRICT — so deleting any account that has ever
   entered a mark, taken attendance, sent a message, reported a message,
   created an event, or performed an audited action raises a foreign key
   violation. In practice that's nearly every teacher/admin within days, so
   rather than let that surface as a raw Postgres error (or, worse, silently
   do nothing), this catches it and tells the caller to disable the account
   instead — which already works today, stops sign-in, and keeps history
   intact. Deletion stays available for the case it's actually safe: a
   brand-new account with no activity behind it yet (e.g. a typo'd login). */

create or replace function public.delete_user_account(p_id uuid)
returns void language plpgsql security definer as $$
declare
  target_name text;
  target_role text;
  other_active_admins int;
begin
  if not public.has_perm('users.manage') then
    raise exception 'Deleting accounts requires the users.manage permission.';
  end if;
  if p_id = auth.uid() then
    raise exception 'You can''t delete your own account.';
  end if;

  select full_name, role into target_name, target_role
  from public.profiles where id = p_id;
  if target_name is null then
    raise exception 'That account no longer exists.';
  end if;

  if target_role = 'admin' then
    select count(*) into other_active_admins
    from public.profiles where role = 'admin' and status = 'active' and id <> p_id;
    if other_active_admins = 0 then
      raise exception 'The school needs at least one active administrator.';
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_name, action, target, detail)
  select auth.uid(), p2.full_name, 'user.delete', target_name, 'role=' || target_role
  from public.profiles p2 where p2.id = auth.uid();

  begin
    delete from auth.users where id = p_id; -- cascades to public.profiles (on delete cascade)
  exception
    when foreign_key_violation then
      raise exception '% has activity on record (marks, attendance, messages, etc.) and can''t be permanently deleted — disable the account instead so it keeps its history but can no longer sign in.', target_name;
  end;
end $$;

revoke all on function public.delete_user_account(uuid) from public;
grant execute on function public.delete_user_account(uuid) to authenticated;
