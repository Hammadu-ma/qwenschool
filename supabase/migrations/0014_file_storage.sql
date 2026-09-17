-- Generic object-storage registry for Cloudflare R2.
--
-- Design: this table is intentionally generic (owner_type/owner_id) so every
-- future upload — staff photos, a school logo, receipts, message attachments —
-- reuses the same table, the same edge function, and the same two SQL
-- functions below, instead of a bespoke column + bucket per feature.
--
-- The actual bytes live in R2, never in Postgres. This table only tracks
-- *who is allowed to see/manage which key*, plus light metadata. The
-- `can_view_file` / `can_manage_file` functions are the single source of
-- truth for that authorization and are called from two places that must
-- always agree: the RLS policies below, and the `r2-storage` edge function
-- (via supabase-js .rpc(), using the caller's own JWT so it's bound by the
-- same RLS/permission rules as everything else in this app).


create table if not exists public.file_objects (
  id            uuid primary key default gen_random_uuid(),
  owner_type    text not null,          -- 'student_photo' | 'student_document' | … (extend the functions below to add more)
  owner_id      text not null,          -- business id of the owning row (e.g. a students.id)
  storage_key   text not null unique,   -- full R2 object key
  original_name text,
  mime_type     text,
  size_bytes    bigint,
  kind          text,                   -- free-form sub-category, e.g. 'transcript', 'birth_certificate'
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists ix_file_objects_owner on public.file_objects (owner_type, owner_id);

alter table public.file_objects enable row level security;

-- Add a new `when` branch here for every new owner_type you introduce.
create or replace function public.can_view_file(p_owner_type text, p_owner_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_owner_type
    when 'student_photo'    then can_view_student(p_owner_id)
    when 'student_document' then can_view_student(p_owner_id)
    else is_admin()
  end;
$$;

create or replace function public.can_manage_file(p_owner_type text, p_owner_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_owner_type
    when 'student_photo'    then can_view_student(p_owner_id) and has_perm('students.edit')
    when 'student_document' then can_view_student(p_owner_id) and has_perm('students.edit')
    else is_admin()
  end;
$$;

grant execute on function public.can_view_file(text, text) to authenticated;
grant execute on function public.can_manage_file(text, text) to authenticated;

drop policy if exists file_objects_select on public.file_objects;
create policy file_objects_select on public.file_objects for select
  using (can_view_file(owner_type, owner_id));

drop policy if exists file_objects_insert on public.file_objects;
create policy file_objects_insert on public.file_objects for insert
  with check (can_manage_file(owner_type, owner_id) and uploaded_by = auth.uid());

drop policy if exists file_objects_delete on public.file_objects;
create policy file_objects_delete on public.file_objects for delete
  using (can_manage_file(owner_type, owner_id));

-- No update policy: uploads are immutable rows — "replace" is delete + insert.

