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
| `0009_lowercase_usernames.sql` | Fixes login failing for usernames typed with any capital letters |
| `0010_academic_years_permission.sql` | Adds a dedicated academic-years/terms management permission |
| `0011_conversation_participants_policy.sql` | Fixes starting a new direct conversation always failing |
| `0012_student_visible_published_submissions.sql` | Fixes students/guardians seeing no grades, even once published |
| `0013_enable_realtime_messaging.sql` | Enables Realtime on messaging tables so conversations update live |
| `0014_file_storage.sql` | Generic `file_objects` registry + authorization functions backing Cloudflare R2 storage (§6) |

**Fastest — Supabase CLI (recommended):** applies all 14 files in one command, no browser
copy-paste at all.
```bash
supabase login
supabase link --project-ref nrahbfmajwdgphmdllgm
supabase db push
```

**No CLI available — in-app console, one paste:** the login page shows a "Connect the live
database" panel when the schema isn't detected yet. Open the **Guided** tab and click
**\"Copy all migrations as one script\"** — it's every file concatenated in order, each wrapped
in its own transaction, so it's a single copy → paste into the SQL Editor → click Run, instead of
repeating that once per file. Then click **Re-check & connect**.

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

## 6. File storage — Cloudflare R2

Student photos and documents are binary files, so they don't live in Postgres —
`students.photo_path` and `student_documents.storage_path` each hold an **R2 object
key** (a string), and the actual bytes live in a Cloudflare R2 bucket. The browser
never touches R2 directly or holds an R2 credential: it asks a Supabase Edge
Function (`r2-storage`) for a short-lived presigned URL, then uploads/downloads
straight from R2 with that URL. This also means every future file type (staff
photos, a school logo, receipts, …) reuses the same table (`file_objects`), the
same edge function, and the same two SQL functions — see the comments in
`supabase/migrations/0014_file_storage.sql`.

### 6.1 Create the R2 bucket

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**.
   - Name it something like `riverside-files`.
   - Location: Automatic is fine.
   - Leave it **private** (do not enable public access) — every file is served
     through a short-lived signed URL instead.
2. Note your **Account ID**, shown on the R2 overview page (also in the URL:
   `dash.cloudflare.com/<ACCOUNT_ID>/r2`).

### 6.2 Create an API token (S3-compatible credentials)

1. On the R2 overview page → **Manage API Tokens** → **Create API Token**.
2. Permissions: **Object Read & Write**, scoped to the one bucket you just
   created (not "all buckets").
3. Save the **Access Key ID** and **Secret Access Key** it shows you — the
   secret is only ever shown once.

### 6.3 CORS (only needed if you'll ever list/preview from a different origin)

Uploads/downloads here go through presigned URLs called directly from the
browser, so add a CORS policy on the bucket (R2 dashboard → bucket →
**Settings** → **CORS Policy**) allowing your app's origin(s):

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://your-production-domain.example"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

### 6.4 Apply the new migration

`0014_file_storage.sql` adds the `file_objects` table and its RLS/authorization
functions. Apply it the same way as the others (§1) — `supabase db push`, or
paste it into the SQL editor.

### 6.5 Deploy the edge function and set its secrets

The edge function is the only place the R2 credentials are ever held.

```bash
supabase functions deploy r2-storage

supabase secrets set \
  R2_ACCOUNT_ID=<your account id> \
  R2_ACCESS_KEY_ID=<access key id from 6.2> \
  R2_SECRET_ACCESS_KEY=<secret access key from 6.2> \
  R2_BUCKET=riverside-files
```

(`SUPABASE_URL` and `SUPABASE_ANON_KEY` are already injected into every edge
function automatically — don't set those yourself.)

No frontend `.env` changes are needed for storage itself: the client only ever
calls `supabase.functions.invoke("r2-storage", …)`, using the same
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` it already has.

### 6.6 Try it

- Register a new student and upload a photo on the "Photo & Docs" step — it
  should upload immediately and the preview should switch from the local
  blob preview to the real thing once the signed URL round-trips.
- Open that student's profile → **Documents** tab after attaching a file
  during registration, and click **Open** — it should fetch a signed link
  and open the file in a new tab.
- If storage isn't configured yet (no `VITE_SUPABASE_URL`/anon key, i.e.
  offline demo mode), photo/document upload silently falls back to the old
  inline-base64 behavior so the demo still works without R2.

### Known follow-ups (not yet implemented)

- Removing a document/photo in the wizard only removes it from the form —
  the R2 object and its `file_objects` row are left behind. `deleteFile()` in
  `src/lib/storage.ts` does the right thing; it just isn't wired up to those
  "Remove"/"×" buttons yet.
- The `ALLOWED_OWNER_TYPES` set in the edge function and the `case` branches
  in `can_view_file`/`can_manage_file` need a new entry each time you add a
  genuinely new kind of upload (e.g. `staff_photo`).

## 7. What was removed / replaced

- localStorage "database" (`riverside.db.v3`) and plaintext-password login — **replaced** by
  Supabase Auth + hydrated/diff-synced PostgreSQL data (`src/lib/backend.ts`).
- Client-trusted session id — **replaced** by the Supabase session (`auth.uid()`).
- No credentials beyond the publishable anon key are present in the client bundle.
