/* Manual bank-transfer payments: a guardian picks a fee item + the school's
   bank account, pays outside the app, then submits a receipt here. It sits
   'pending' until someone with fees.manage reviews the receipt and approves
   or rejects it. Approval itself does NOT happen in SQL — the admin's own
   client session (which already has fees.manage) appends the resulting
   Payment onto fee_items.payments and bumps `paid` through the normal
   diff-sync, exactly like a manually recorded payment. This table only
   needs to let a guardian INSERT their own child's request and let
   fees.manage UPDATE its status. */

create table if not exists public.fee_payment_requests (
  id                 text primary key,
  student_id         text not null references public.students(id) on delete cascade,
  fee_item_id        text not null references public.fee_items(id) on delete cascade,
  amount             numeric(10,2) not null check (amount > 0),
  bank_account_id    text not null,
  bank_name          text not null,
  reference          text,
  receipt_path       text,
  receipt_name       text,
  submitted_by       uuid references public.profiles(id) on delete set null,
  submitted_by_name  text,
  submitted_at       timestamptz not null default now(),
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by        uuid references public.profiles(id) on delete set null,
  reviewed_by_name   text,
  reviewed_at        timestamptz,
  review_note        text
);

create index if not exists ix_fee_payment_requests_student on public.fee_payment_requests (student_id);
create index if not exists ix_fee_payment_requests_status  on public.fee_payment_requests (status);

alter table public.fee_payment_requests enable row level security;

drop policy if exists fee_payment_requests_sel on public.fee_payment_requests;
create policy fee_payment_requests_sel on public.fee_payment_requests for select to authenticated
  using (
    public.is_admin()
    or public.has_perm('fees.manage')
    or exists (select 1 from public.guardian_students g where g.guardian_id = auth.uid() and g.student_id = student_id)
  );

-- A guardian may only file a request for their own linked child, as
-- themselves, and it must start out pending — everything else (approving,
-- backdating a decision) goes through the update policy below instead.
drop policy if exists fee_payment_requests_ins on public.fee_payment_requests;
create policy fee_payment_requests_ins on public.fee_payment_requests for insert to authenticated
  with check (
    status = 'pending'
    and reviewed_by is null
    and (
      public.is_admin()
      or (
        submitted_by = auth.uid()
        and exists (select 1 from public.guardian_students g where g.guardian_id = auth.uid() and g.student_id = student_id)
      )
    )
  );

-- Only fees.manage can move a request out of pending (approve/reject).
drop policy if exists fee_payment_requests_upd on public.fee_payment_requests;
create policy fee_payment_requests_upd on public.fee_payment_requests for update to authenticated
  using (public.has_perm('fees.manage'))
  with check (public.has_perm('fees.manage'));

drop policy if exists fee_payment_requests_del on public.fee_payment_requests;
create policy fee_payment_requests_del on public.fee_payment_requests for delete to authenticated
  using (public.has_perm('fees.manage'));

/* Bank accounts guardians pay into — kept as jsonb on the single schools
   row, same pattern as fee_items.payments. Admin-managed via settings.manage. */
alter table public.schools
  add column if not exists bank_accounts jsonb not null default '[]'::jsonb;

comment on column public.schools.bank_accounts is
  'Array of {id, bankName, accountName, accountNumber, branch, note} shown to guardians for manual bank transfers.';

/* ---- receipts: extend the generic file_objects authorization ---- */
create or replace function public.can_view_file(p_owner_type text, p_owner_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_owner_type
    when 'student_photo'    then can_view_student(p_owner_id)
    when 'student_document' then can_view_student(p_owner_id)
    when 'fee_receipt'      then can_view_student(p_owner_id) or has_perm('fees.manage')
    else is_admin()
  end;
$$;

create or replace function public.can_manage_file(p_owner_type text, p_owner_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_owner_type
    when 'student_photo'    then can_view_student(p_owner_id) and has_perm('students.edit')
    when 'student_document' then can_view_student(p_owner_id) and has_perm('students.edit')
    -- A guardian uploads their own child's receipt when filing the request;
    -- fees.manage can also attach/replace one while reviewing.
    when 'fee_receipt'      then can_view_student(p_owner_id) or has_perm('fees.manage')
    else is_admin()
  end;
$$;
