# Year scoping, scale, and role-scoped loading

What I changed, why, and what still needs your hands on it.

---

## The two problems I found

**1. Most tables had no academic year.** `enrollments`, `homework`,
`teacher_assignments` and `assessment_structures` were year-scoped. Everything
else was not: timetables, attendance registers, fee items, events,
announcements, conversations, and the grading scale all floated free. The
practical consequences:

- A timetable for 2026/27 **collided** with 2025/26 — the unique key was
  `(class, section, day, period)` with no year in it. Same for attendance:
  the same calendar day in two different years fought over one row.
- "Show me last year" was impossible to express.
- Every query scanned all history forever, because there was nothing to
  filter on.

**2. Every login downloaded the whole school.** `get_app_bootstrap()` selects
every student, every profile, every homework row, every timetable entry, for
every year, on every sign-in. The frontend then keeps it all in one in-memory
`DB` object and filters it with `Array.filter` — so searching students is
O(n) on the UI thread per keystroke. At 300 students this feels fine. At
3,000 it is several megabytes before first paint and a stuttering search box.
At 10,000 the tab runs out of memory.

Both are architectural, so both fixes are architectural.

---

## What's new

### Migrations (additive, idempotent, no data loss)

| File | What it does |
|---|---|
| `0021_year_scope.sql` | Adds `year_id` to every table that lacked one, backfills it from each row's own evidence, adds FKs and NOT NULL, and **rebuilds the unique keys to include the year**. Triggers keep denormalised `year_id` honest on the big tables. |
| `0022_performance.sql` | Composite and partial indexes sized for ~1M attendance rows/year, trigram indexes for fast name search, and extended statistics so the planner stops underestimating `(year, class, section)`. |
| `0023_scoped_bootstrap.sql` | `get_bootstrap(year)` — role-shaped and year-scoped. An admin gets counts, a teacher gets their sections, a student gets themselves. Tens of KB regardless of school size. |
| `0024_paged_queries.sql` | Server-side paging, searching, sorting and aggregation: `list_students`, `get_student_detail`, `get_marksheet`, `get_register`, `get_attendance_summary`, `list_fees`, `list_messages`, `list_conversations`, `list_notifications`, `list_audit`. |
| `0025_year_lifecycle.sql` | The missing half of year scoping — how a school *starts* a new year. |

### Frontend

| File | What it does |
|---|---|
| `src/lib/yearContext.tsx` | Holds the selected year. It's part of every query key, so switching years re-reads the entire app and pages can't mix years. |
| `src/lib/api.ts` | Paged, year-scoped, role-scoped hooks on the RPCs above, plus prefetch helpers. |
| `src/lib/session.ts` | Decodes the stored JWT synchronously so the shell paints without waiting for a network round trip. |

---

## Applying it

Run in order, via the Supabase CLI or the SQL Editor:

```
supabase db push          # or paste 0021 → 0025 in sequence
```

**Before you run 0021 on real data**, check the warnings it emits. If a table
still has rows it couldn't assign a year to, it leaves the column nullable and
tells you which table and how many rows, rather than failing halfway through
an `ALTER`. Assign those rows a year and re-run — it's safe to re-run.

**If your database is already large**, `0022` creates indexes with a write
lock. Run each `create index` separately as `create index concurrently`,
outside a transaction, instead of running the file as one unit. On a fresh or
small database, run it as-is.

---

## What "each role loads only its own data" now means

The boundary is enforced in PostgreSQL, in two layers that agree with each
other:

- **RLS policies** (your existing `0002_rls_functions.sql`) still govern every
  direct PostgREST request. Unchanged.
- **The paged functions** resolve the caller's scope *once* and apply it as a
  set-based predicate, instead of RLS evaluating `can_view_student()` once per
  row. Same boundary, one evaluation instead of five thousand.

That second point is why `list_students` is `SECURITY DEFINER`. It is not a
way around RLS — the tables underneath still have it enabled, and the function
resolves the same role rules. It's a faster road to the same answer. Read the
scope block in `list_students` before you extend it; that `and (...)` clause
is the security boundary and it must stay in every query you add.

The client never filters for security. It couldn't if it wanted to — it no
longer has the other roles' data in memory to filter out.

---

## What I added that was missing

Once every record carries a year, the obvious question is what happens in
September. There was no answer: an administrator would have had to hand-create
the year and re-enter every assignment, timetable slot, assessment structure
and grade band, then re-enroll every student one at a time.

`0025_year_lifecycle.sql` adds:

- **`create_academic_year(...)`** — new year plus its terms in one call.
- **`rollover_year(from, to)`** — copies *structure* (assignments, timetable,
  grading scale, assessment shapes and their items, fee templates) into the
  new year. Never copies records; last year's marks stay in last year.
- **`promote_students(from, to)`** — moves every active enrollment up one class
  level and graduates the top year, in one statement for the whole school.
  Idempotent: `unique (student_id, year_id)` means re-running can't duplicate
  anyone.
- **`fee_templates` + `apply_fee_template(id)`** — define a fee once per class
  instead of creating 3,000 `fee_items` rows by hand.
- **`close_year(id)`** and a `status` column — a finished year becomes
  read-only, guarded by a trigger on every record table. History stops being
  editable by accident.
- **`set_active_year(id)`** — audited, and correct against the one-active-year
  unique index.

---

## Wiring it into the UI — this part is still yours

I did **not** rewrite `people.tsx` (1,542 lines), `academics.tsx` (2,520) or
`communication.tsx` (816). They still read the in-memory `DB` from
`store.tsx`, and they still work — nothing I added breaks them, and
`get_app_bootstrap()` is left in place, marked deprecated, for exactly that
reason.

But they are where the remaining slowness lives, so migrating them is the
work that actually delivers the speed. In dependency order:

**1. Mount the year provider** (in `App.tsx`, inside `AppProvider`):

```tsx
<AcademicYearProvider>
  <HashRouter>…</HashRouter>
</AcademicYearProvider>
```

Add a year picker to `Layout.tsx` bound to `useAcademicYear()`. Show a clear
banner when `isHistorical` or `isReadOnly` is true — people will otherwise
enter this year's marks into last year.

**2. Switch the boot call.** In `store.tsx`, replace `hydrateCore()`'s
`get_app_bootstrap` call with `useBootstrap()` from `src/lib/api.ts`. Use
`peekSession()` from `session.ts` to set `sessionChecked` optimistically on
the first render instead of blocking on `getSession()`.

**3. Convert the list pages, one at a time.** `StudentsPage` is the highest
value and the easiest: replace the in-memory filter with `useStudents({ classId, sectionId, search, page })`
and render `rows` with `total` for the pager. Debounce the search input by
~250ms. Add `onMouseEnter={() => prefetch.student(id)}` to each row.

Then `FeesPage` → `useFees`, `AttendancePage` → `useRegister` /
`useAttendanceSummary`, `MarkEntryPage` → `useMarksheet`, `MessagesPage` →
`useMessages` (infinite scroll, keyset — scrolling back two years costs the
same as the first screen).

**4. Delete `get_app_snapshot()` from the boot path** once nothing calls it.
Keep the function for the rare recovery resync; never call it on login.

---

## One thing I'd push back on

"Handle thousands of records at very high speed" is achievable and most of it
is above — but the current write path will limit you before the read path
does. `sync()` in `backend.ts` diffs two full `DB` snapshots on every
`update()` and applies the delta. That's fine at 300 students and untenable at
5,000: you're diffing megabytes of JavaScript objects to save one changed
mark.

`save_student_marks()` in `0002` is already the right pattern — a targeted RPC
that writes exactly what changed. The remaining writes should follow it rather
than going through snapshot diffing. I'd treat that as the next piece of work
after the list pages, and it's a bigger change than anything here, so I've
left it rather than half-doing it.

## A note on your anon key

`src/lib/supabase.ts` hardcodes a project URL and anon key as fallbacks. That
is genuinely fine — the anon key is publishable by design and RLS is what
protects the data. But it also means anyone with the bundle points at *your*
project. Before you go live, set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in the deployment environment and drop the hardcoded
defaults, so a fork doesn't quietly write into your database.
