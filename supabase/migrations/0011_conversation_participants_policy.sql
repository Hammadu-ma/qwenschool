/* Bug fix: starting a new direct conversation was impossible.

   openDirect() (client) creates a conversation with BOTH participants
   (yourself + the person you're messaging) in one batch insert into
   conversation_participants. But the original policy only allowed a row
   where profile_id = auth.uid() — i.e. you could only ever insert a
   participant row for YOURSELF. Since a Postgres RLS with-check applies to
   every row in a batch insert, the other person's row was always rejected,
   and the whole insert failed atomically. Every attempt to start a new
   conversation failed at this step, even though messaging inside an
   existing conversation worked fine.

   Fix: also allow inserting a participant row for someone else, as long as
   you're actually allowed to message them — reusing can_message_user(),
   the exact same relationship check the client's own "can I message this
   person" gate is built on. */

drop policy if exists convp_ins on public.conversation_participants;
create policy convp_ins on public.conversation_participants
  for insert to authenticated
  with check (
    public.has_perm('communication.send')
    and (profile_id = auth.uid() or public.can_message_user(profile_id))
  );
