/* 0013_enable_realtime_messaging.sql
   Turns on Supabase Realtime (Postgres change streaming) for the tables the
   Messages screen needs to update live, instead of only on next page load:

     - messages                 new messages appear instantly; a message's
                                 read_by flip (sent → read) updates the
                                 sender's ticks live, without a refetch.
     - conversations            a conversation's updated_at bump (used to
                                 re-sort the inbox) is pushed live.
     - conversation_participants  lets a person's browser learn about a
                                 brand-new conversation someone just started
                                 with them, the moment it's created.

   RLS stays the authority: adding a table to supabase_realtime only lets
   Postgres changes be *streamed*; each connected client still only receives
   rows its own session could `select` under the table's existing RLS
   policies (msgs_sel / conv_sel / conv_part_sel from 0002_rls_functions.sql).
   This migration grants no new access on its own — it's idempotent and
   safe to re-run. */

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_participants'
  ) then
    alter publication supabase_realtime add table public.conversation_participants;
  end if;
end $$;
