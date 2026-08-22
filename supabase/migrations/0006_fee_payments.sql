/* Adds a per-transaction payment history to fee_items, so each payment
   records its own method (cash / mobile money / bank transfer / cheque),
   a reference number, and — for bank transfers — which bank it came
   through. Additive only: existing rows default to an empty history and
   keep working with the existing `paid` running total. */

alter table public.fee_items
  add column if not exists payments jsonb not null default '[]'::jsonb;

comment on column public.fee_items.payments is
  'Array of {id, amount, method, reference, bank, date, recordedBy} — one entry per payment transaction.';
