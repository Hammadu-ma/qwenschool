# Riverside School Management System — Supabase Backend

The application now runs on a **real Supabase/PostgreSQL backend** with Supabase Auth and
Row Level Security. There is no fake database layer: every read is an RLS-filtered select
and every write is an upsert/delete (or a SECURITY DEFINER RPC) against the live project.

Project ref: `nrahbfmajwdgphmdllgm` · URL: `https://nrahbfmajwdgphmdllgm.supabase.co`

---

## 1. Apply the database (do this first)

All schema, RLS, functions and seed data live in `supabase/migrations/`:

| File | Contents |
|------|----------|
| `0001_schema.sql` | Relational tables, FKs, unique/check constraints, indexes, `updated_at` triggers |
| `0002_rls_functions.sql` | Authorization helpers, RLS policies, mark-workflow + audit triggers, privileged RPCs |
| `0003_seed_core.sql` | School, years, classes/sections, subjects, teachers, students, enrollments, roles, **auth users** |
| `0004_seed_academics.sql` | Assessment structures, marks, submissions, attendance, fees, timetable, homework, communication |
| `0005_repair_auth_seed.sql` | Fixes a GoTrue "500 querying schema" error some Supabase projects hit on login |
| `0006_fee_payments.sql` | Adds per-transaction payment history (method, reference, bank) to fee items |
| `0007_fix_create_user_email.sql` | Fixes new accounts getting an unusable login email when no personal email was given |
| `0008_fix_auth_token_columns.sql` | Fixes a 500 on login for accounts created after registration (missing auth token columns) |

**Fastest — Supabase CLI (recommended):** applies all 8 files in one command, no browser
copy-paste at all.
```bash
supabase login
supabase link --project-ref nrahbfmajwdgphmdllgm
supabase db push
```

**No CLI available — in-app console, one paste:** the login page shows a "Connect the live
database" panel when the schema isn't detected yet. Open the **Guided** tab and click
**"Copy all 8 migrations as one script"** — it's every file concatenated in order, each wrapped
in its own transaction, so it's a single copy → paste into the SQL Editor → click Run, instead of
repeating that seven times. Then click **Re-check & connect**.

If you need to debug which specific file failed, the same panel has a "run them one at a time
instead" toggle that copies each file individually.

The **Automatic** tab (paste a service_role key, the app calls the Management API directly) is
also available, but many browsers block that call outright (CORS) — the combined-script option
above is the more reliable path for most people and never requires the service_role key to touch
the browser at all.

**Every path is idempotent** (`if not exists` / `on conflict do nothing`) and never drops data —
safe to re-run if you're not sure what already applied.

> The seed creates working Auth accounts (bcrypt-hashed passwords, proper identities), so
> sign-in works immediately after applying — no separate bootstrap or service-key script needed.

## 2. Configure the frontend

`.env` already contains the **publishable anon key only** (public by design). If you recreate it:
```
VITE_SUPABASE_URL=https://nrahbfmajwdgphmdllgm.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable anon key>
```
Then `npm run dev` / `npm run build`. Vite inlines `VITE_*` at build time.

## 3. Demo logins (username → `username@riverside.school`)

| Username | Password | Role | Scope |
|----------|----------|------|-------|
| `root` | `root123` | Super Admin | everything, incl. roles & permissions |
| `admin` | `admin123` | School Administrator | school-wide (not role management) |
| `lydia` | `coord123` | Academic Coordinator | academics/results, no user/role admin |
| `ahmed` | `teach123` | Teacher | only his assigned class-sections → their students → their guardians |
| `hana.g` | `teach123` | Teacher | only her assigned class-sections |
| `abebe` | `stud123` | Student | own records; published results only |
| `hana.a` | `stud123` | Student | own records |
| `kebede` | `fam123` | Guardian | children `st1`, `st2` only |
| `almaz` | `fam123` | Guardian | child `st3` only |
| `ali` | `teach123` | Teacher (disabled) | login rejected |

**Rotate these passwords in production.** They were shared in plaintext during setup.

## 4. Security model

- **Auth:** Supabase Auth (email + bcrypt). No plaintext passwords anywhere in the client.
- **Identity → role:** `auth.users.id` → `profiles.role` / `profiles.role_def_id`. The role is
  read server-side from the session; it is never trusted from the client.
- **Two-level authorization** (both must pass):
  1. **Role permission** — `has_perm('marks.enter')` etc., from `role_permissions`.
  2. **Relationship** — e.g. a teacher only reaches students in `teacher_assignments` sections;
     a guardian only reaches rows in `guardian_students`.
- **RLS is ON for every sensitive table.** Policies use `auth.uid()` + SECURITY DEFINER helper
  functions (`current_profile()`, `is_admin()`, `my_student_ids()`, `can_view_student()`, …).
- **Privileged ops are RPCs:** `create_user_account`, `notify_users`, `log_action` — all
  `security definer`, permission-gated. The **service_role key is never used by the frontend**.
- **Marks integrity:** a trigger enforces the draft→submitted→approved→published→(returned)
  state machine, blocks self-approval, and writes every change to immutable `mark_audit`.

## 5. RLS test matrix (run as each persona in the SQL editor or via the client)

| Attempt | Expected |
|---------|----------|
| Anon: `select * from students` | 0 rows / denied |
| Student A: `select * from students` | only own row |
| Student A: `update assessment_marks …` | denied |
| Guardian A: read Guardian B's children | 0 rows |
| Teacher A: read students in Teacher B's section | 0 rows |
| Any user: `update profiles set role='admin'` | denied (trigger + policy) |
| Teacher: `select` another teacher's conversation | 0 rows |
| Student/guardian: read un-published marks | 0 rows (published only) |

## 6. Storage (optional follow-up)

Profile photos currently persist in `students.photo_path` and documents in
`student_documents` so the flows work end-to-end. To move binaries to Supabase Storage,
create **private** buckets `profile-photos` and `student-documents` with policies mirroring
`can_view_student`, then upload via `supabase.storage` and store only the path.

## 7. What was removed / replaced

- localStorage "database" (`riverside.db.v3`) and plaintext-password login — **replaced** by
  Supabase Auth + hydrated/diff-synced PostgreSQL data (`src/lib/backend.ts`).
- Client-trusted session id — **replaced** by the Supabase session (`auth.uid()`).
- No credentials beyond the publishable anon key are present in the client bundle.
